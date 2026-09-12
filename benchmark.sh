#!/usr/bin/env bash
# Benchmark px0 against real repositories.
#
# Every number printed here comes from a running server: timings from curl,
# memory from /proc, index size from the server's own /api/meta.
set -u
unalias find 2>/dev/null || true
unset -f find 2>/dev/null || true

BIN=${BIN:-./px0}
CORPUS=${CORPUS:-./bench-repos}
PORT=${PORT:-7900}
RUNS=${RUNS:-5}

# name|url - shallow single-branch clones, no submodules
REPOS="
flask|https://github.com/pallets/flask
redis|https://github.com/redis/redis
react|https://github.com/facebook/react
django|https://github.com/django/django
typescript|https://github.com/microsoft/TypeScript
kubernetes|https://github.com/kubernetes/kubernetes
linux|https://github.com/torvalds/linux
"

usage() {
  cat <<'EOF'
usage: ./benchmark.sh [mode] [directory ...]

modes:
  (none)       benchmark every repo in the corpus, or the directories given
  --clone      fetch the standard corpus into ./bench-repos (about 3 GB)
  --memory     trace resident memory through index, search and file open
  --lsp        time go-to-definition, references, hover and outline
  --help       show this

examples:
  ./benchmark.sh --clone
  ./benchmark.sh
  ./benchmark.sh ~/src/myproject
  ./benchmark.sh --memory bench-repos/linux
  ./benchmark.sh --lsp .
  RUNS=20 ./benchmark.sh bench-repos/redis

environment:
  BIN=./px0             binary to measure
  CORPUS=./bench-repos  where the corpus lives
  PORT=7900             first port to use, incremented per repo
  RUNS=5                requests per timing, the fastest is reported
EOF
}

die() { echo "benchmark: $*" >&2; exit 1; }

clone_corpus() {
  command -v git >/dev/null || die "git is required for --clone"
  mkdir -p "$CORPUS"
  for entry in $REPOS; do
    name=${entry%%|*}; url=${entry##*|}
    if [ -d "$CORPUS/$name/.git" ]; then
      echo "  have   $name"
      continue
    fi
    echo "  clone  $name ..."
    git clone --depth 1 --single-branch --no-tags -q "$url" "$CORPUS/$name" \
      || echo "         failed: $name"
  done
  echo "corpus ready in $CORPUS ($(du -sh "$CORPUS" 2>/dev/null | cut -f1))"
}

# start DIR PORT [extra flags...] - echoes the pid, waits until it answers
start_server() {
  local dir=$1 port=$2; shift 2
  "$BIN" -no-open -port "$port" "$@" "$dir" >"/tmp/px0-bench-$port.log" 2>&1 &
  local pid=$!
  local i
  for i in $(seq 100); do
    curl -sf -o /dev/null "http://127.0.0.1:$port/api/meta" && { echo "$pid"; return 0; }
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.3
  done
  kill "$pid" 2>/dev/null
  return 1
}

# best_ms URL - fastest of RUNS requests, in milliseconds
best_ms() {
  local url=$1 best=999999 t
  for _ in $(seq "$RUNS"); do
    t=$(curl -s -o /dev/null -w '%{time_total}' "$url" 2>/dev/null) || continue
    t=$(awk -v x="$t" 'BEGIN{printf "%.1f", x*1000}')
    awk -v a="$t" -v b="$best" 'BEGIN{exit !(a<b)}' && best=$t
  done
  echo "$best"
}

rss_mb() { awk '/VmRSS/{printf "%.0f", $2/1024}' "/proc/$1/status" 2>/dev/null || echo "?"; }

# The biggest source file in the tree, which is the worst case for opening.
# Skips what px0 itself skips, so the file picked is one the index holds.
biggest_file() {
  local dir=$1 corpus_abs
  local -a prune=()
  corpus_abs=$(cd "$CORPUS" 2>/dev/null && pwd) || corpus_abs=""
  # Prune the corpus only when it sits inside the tree being measured, which is
  # the case when you point the script at px0's own directory.
  case "$corpus_abs" in
    "$dir"/*) prune=(-not -path "$corpus_abs/*") ;;
  esac
  # One -size predicate only: some find implementations drop every result when
  # an upper and a lower bound are combined. The upper bound is applied below.
  find "$dir" -type f -size +80k \
    -not -path '*/.git/*' -not -path '*/node_modules/*' \
    -not -path '*/vendor/*' -not -path '*/dist/*' "${prune[@]}" \
    \( -name '*.go' -o -name '*.c' -o -name '*.h' -o -name '*.py' -o -name '*.js' \
       -o -name '*.ts' -o -name '*.java' -o -name '*.rs' -o -name '*.cpp' \) \
    -printf '%s %P\n' 2>/dev/null \
    | awk '$1 < 8388608' | sort -rn | head -1 | cut -d' ' -f2-
}

# first_match BASE GLOB QUERY - a path the running index actually holds
first_match() {
  curl -s "$1/api/search?q=$(urlenc "$3")&glob=$(urlenc "$2")&case=1" \
    | grep -o '"path":"[^"]*"' | head -1 | sed 's/^"path":"//; s/"$//'
}

# strip_tags - highlighted HTML back to plain text
strip_tags() { sed 's/<[^>]*>//g; s/&lt;/</g; s/&gt;/>/g; s/&amp;/\&/g'; }

urlenc() { printf %s "$1" | sed 's/ /%20/g; s/#/%23/g; s/?/%3F/g'; }

resolve() {
  cd "$1" 2>/dev/null && pwd
}

bench_one() {
  local dir name port=$PORT pid base
  dir=$(resolve "$1") || { echo "  skip $1 (missing)"; return; }
  name=$(basename "$dir")
  pid=$(start_server "$dir" "$port" -no-lsp) || { echo "  skip $name (did not start)"; return; }
  base="http://127.0.0.1:$port"

  local meta files index_ms mem_idx
  meta=$(curl -s "$base/api/meta")
  files=$(echo "$meta" | sed 's/.*"files":\([0-9]*\).*/\1/')
  index_ms=$(echo "$meta" | sed 's/.*"indexMs":\([0-9]*\).*/\1/')
  mem_idx=$(rss_mb "$pid")

  local find_ms scan_ms open_ms warm_ms big
  find_ms=$(best_ms "$base/api/find?q=srv&limit=100")
  # A string that matches nothing forces a full sweep of every indexed file.
  scan_ms=$(best_ms "$base/api/search?q=zzqqxx_no_such_token")

  big=$(biggest_file "$dir")
  if [ -n "$big" ]; then
    local u="$base/api/file?path=$(urlenc "$big")&count=1000"
    open_ms="$(curl -s -o /dev/null -w '%{time_total}' "$u" | awk '{printf "%.1f ms", $1*1000}')"
    warm_ms="$(best_ms "$u") ms"
  else
    open_ms="n/a"; warm_ms="n/a"
  fi

  local mem_peak mb
  mem_peak=$(rss_mb "$pid")
  mb=$(du -sm --exclude=.git "$dir" 2>/dev/null | cut -f1)

  printf '| %-12s | %6s | %7s | %8s | %8s | %9s | %8s | %7s | %7s | %7s |\n' \
    "$name" "${mb} MB" "$files" "${index_ms} ms" "${find_ms} ms" "${scan_ms} ms" \
    "$open_ms" "$warm_ms" "${mem_idx} MB" "${mem_peak} MB"

  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  PORT=$((port + 1))
}

bench_memory() {
  local dir name port=$PORT pid base big
  dir=$(resolve "$1") || die "no such directory: $1"
  name=$(basename "$dir")
  pid=$(start_server "$dir" "$port" -no-lsp) || die "server did not start"
  base="http://127.0.0.1:$port"

  echo "### $name"
  printf '  %-34s %s MB\n' "after indexing" "$(rss_mb "$pid")"
  curl -s "$base/api/find?q=server&limit=100" >/dev/null
  printf '  %-34s %s MB\n' "after a fuzzy find" "$(rss_mb "$pid")"
  local i
  for i in $(seq "$RUNS"); do curl -s "$base/api/search?q=zzqqxx_no_such_token" >/dev/null; done
  printf '  %-34s %s MB\n' "after $RUNS full-tree searches" "$(rss_mb "$pid")"

  big=$(biggest_file "$dir")
  if [ -n "$big" ]; then
    curl -s "$base/api/file?path=$(urlenc "$big")&count=1000" >/dev/null
    printf '  %-34s %s MB\n' "after opening the largest file" "$(rss_mb "$pid")"
    # Walk the whole file the way scrolling does.
    for i in $(seq 0 20); do
      curl -s "$base/api/file?path=$(urlenc "$big")&start=$((i * 1000))&count=1000" >/dev/null
    done
    printf '  %-34s %s MB\n' "after scrolling through it" "$(rss_mb "$pid")"
  fi
  # Resident memory includes pages the Go runtime has freed but not yet handed
  # back. px0 returns them once it has been idle for a while, so wait long
  # enough to see the steady state rather than the high-water mark.
  sleep 8
  printf '  %-34s %s MB\n' "8 seconds idle" "$(rss_mb "$pid")"
  sleep 24
  printf '  %-34s %s MB\n' "30 seconds idle" "$(rss_mb "$pid")"
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  PORT=$((port + 1))
}

bench_lsp() {
  local dir name port=$PORT pid base
  dir=$(resolve "$1") || die "no such directory: $1"
  name=$(basename "$dir")
  pid=$(start_server "$dir" "$port") || die "server did not start"
  base="http://127.0.0.1:$port"

  echo "### $name"
  local servers
  servers=$(curl -s "$base/api/meta" | sed 's/.*"lspServers":\[\([^]]*\)\].*/\1/')
  if [ -z "$servers" ] || [ "$servers" = "$(curl -s "$base/api/meta")" ]; then
    echo "  no language server on PATH for this tree"
    kill "$pid" 2>/dev/null; return
  fi
  echo "  servers: $servers"

  # Probe a file the index really holds, in a language a server here handles.
  local probe="" ext
  for ext in '*.go' '*.rs' '*.ts' '*.py' '*.c'; do
    probe=$(first_match "$base" "$ext" "func ")
    [ -n "$probe" ] && break
    probe=$(first_match "$base" "$ext" "def ")
    [ -n "$probe" ] && break
  done
  [ -n "$probe" ] || { echo "  no source file to probe"; kill "$pid" 2>/dev/null; return; }
  echo "  probe:   $probe"

  # Wait for the server to finish indexing, not just to answer the handshake.
  local t0 t1 state i
  t0=$(date +%s%N)
  for i in $(seq 600); do
    state=$(curl -s "$base/api/lsp/warm?path=$(urlenc "$probe")&wait=2000" \
      | sed 's/.*"state":"\([a-z]*\)".*/\1/')
    case "$state" in ready|failed|off) break ;; esac
    sleep 0.5
  done
  t1=$(date +%s%N)
  printf '  %-26s %s ms  (spawn and index, paid once)\n' "server $state after" "$(( (t1 - t0) / 1000000 ))"
  [ "$state" = "ready" ] || { echo "  server never became ready"; kill "$pid" 2>/dev/null; return; }

  # Take a declaration straight from the server's own outline.
  local entry name line raw col
  entry=$(curl -s "$base/api/lsp/symbols?path=$(urlenc "$probe")&wait=120000" \
    | grep -o '"name":"[^"]*","kind":"\(func\|method\)","line":[0-9]*' | head -1)
  if [ -z "$entry" ]; then
    echo "  server returned no symbols for the probe file"
    kill "$pid" 2>/dev/null; return
  fi
  name=$(echo "$entry" | sed 's/^"name":"//; s/","kind.*//')
  line=$(echo "$entry" | sed 's/.*"line"://')
  raw=$(curl -s "$base/api/file?path=$(urlenc "$probe")&start=$((line - 1))&count=1" \
    | sed 's/.*"lines":\["//; s/"\].*//' | strip_tags)
  col=$(awk -v s="$raw" -v n="$name" 'BEGIN{ i=index(s,n); print (i?i-1:0) }')
  printf '  %-26s %s at line %s, column %s\n' "symbol" "$name" "$line" "$col"

  local q="path=$(urlenc "$probe")&line=$line&col=$col"
  printf '  %-26s %s ms\n' "go to definition" "$(best_ms "$base/api/lsp/def?$q")"
  printf '  %-26s %s ms\n' "find all references" "$(best_ms "$base/api/lsp/refs?$q")"
  printf '  %-26s %s ms\n' "hover" "$(best_ms "$base/api/lsp/hover?$q")"
  printf '  %-26s %s ms\n' "document outline" "$(best_ms "$base/api/lsp/symbols?path=$(urlenc "$probe")")"
  printf '  %-26s %s MB   (px0 only; servers are separate processes)\n' "px0 memory" "$(rss_mb "$pid")"
  local g
  g=$(pgrep -x gopls 2>/dev/null | head -1)
  [ -n "$g" ] && printf '  %-26s %s MB\n' "gopls memory" "$(rss_mb "$g")"

  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  PORT=$((port + 1))
}

case "${1-}" in
  --help|-h) usage; exit 0 ;;
  --clone)   clone_corpus; exit 0 ;;
  --memory)  shift; [ $# -gt 0 ] || set -- "$CORPUS"/*/
             [ -x "$BIN" ] || die "$BIN not found; run: go build -o px0 ."
             for t in "$@"; do bench_memory "${t%/}"; done; exit 0 ;;
  --lsp)     shift; [ $# -gt 0 ] || set -- .
             [ -x "$BIN" ] || die "$BIN not found; run: go build -o px0 ."
             for t in "$@"; do bench_lsp "${t%/}"; done; exit 0 ;;
  -*)        die "unknown option: $1 (try --help)" ;;
esac

[ -x "$BIN" ] || die "$BIN not found; run: go build -o px0 ."
command -v curl >/dev/null || die "curl is required"

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  [ -d "$CORPUS" ] || die "no corpus; run: $0 --clone"
  targets=("$CORPUS"/*/)
fi

echo "| Repo         | Source | Files   | Index    | Fuzzy   | Full scan | Open big | Reopen  | Mem     | Peak    |"
echo "| ------------ | ------ | ------- | -------- | ------- | --------- | -------- | ------- | ------- | ------- |"
for t in "${targets[@]}"; do bench_one "${t%/}"; done
