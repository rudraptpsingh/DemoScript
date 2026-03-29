#!/bin/bash
set -e

BASE_URL="${1:-http://localhost:3099}"
TEST_SITE="$BASE_URL/test-site.html"
PASS=0
FAIL=0

pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "=== DemoScript Test Suite ==="
echo "Base URL: $BASE_URL"
echo "Test site: $TEST_SITE"
echo ""

# Test 1: Capture API
echo "[1] Testing capture API..."
CAPTURE=$(curl -s -X POST "$BASE_URL/api/capture" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$TEST_SITE\"}")

HAS_SCREENSHOT=$(echo "$CAPTURE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('screenshotBase64','')) > 1000)" 2>/dev/null)
ELEMENT_COUNT=$(echo "$CAPTURE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('elements',[])))" 2>/dev/null)

[ "$HAS_SCREENSHOT" = "True" ] && pass "Screenshot captured" || fail "Screenshot missing"
[ "$ELEMENT_COUNT" -gt "3" ] 2>/dev/null && pass "$ELEMENT_COUNT elements detected" || fail "Too few elements: $ELEMENT_COUNT"

# Test 2: Render API
echo ""
echo "[2] Testing render API..."
JOB_RESPONSE=$(curl -s -X POST "$BASE_URL/api/render" \
  -H "Content-Type: application/json" \
  -d "{
    \"script\": {
      \"id\": \"test-auto-001\",
      \"url\": \"$TEST_SITE\",
      \"viewport\": {\"width\": 1280, \"height\": 720},
      \"fps\": 24,
      \"outputFormat\": \"mp4\",
      \"createdAt\": \"2024-01-01T00:00:00Z\",
      \"steps\": [
        {\"id\":\"1\",\"order\":1,\"target\":null,\"targetLabel\":\"Page\",\"action\":\"wait\",\"duration\":1.0},
        {\"id\":\"2\",\"order\":2,\"target\":\"#hero h1\",\"targetLabel\":\"Heading\",\"action\":\"highlight\",\"duration\":1.5,\"highlightColor\":\"#6366F1\"},
        {\"id\":\"3\",\"order\":3,\"target\":\"#features\",\"targetLabel\":\"Features\",\"action\":\"scroll-to\",\"duration\":1.5,\"easing\":\"ease-in-out\"}
      ]
    }
  }")

JOB_ID=$(echo "$JOB_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('jobId',''))" 2>/dev/null)
[ -n "$JOB_ID" ] && pass "Job created: $JOB_ID" || fail "Job creation failed"

# Test 3: Poll until complete
if [ -n "$JOB_ID" ]; then
  echo ""
  echo "[3] Waiting for render to complete..."
  FINAL_STATUS="unknown"
  for i in $(seq 1 60); do
    sleep 3
    STATUS_RESPONSE=$(curl -s "$BASE_URL/api/job/$JOB_ID")
    STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
    PROGRESS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('progress',0))" 2>/dev/null)
    echo "  ... ${i}: $STATUS ($PROGRESS%)"

    if [ "$STATUS" = "complete" ]; then
      FINAL_STATUS="complete"
      pass "Render complete in ~$((i*3))s"
      break
    elif [ "$STATUS" = "failed" ]; then
      FINAL_STATUS="failed"
      ERROR=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
      fail "Render failed: $ERROR"
      break
    fi
  done

  # Test 4: Download
  if [ "$FINAL_STATUS" = "complete" ]; then
    echo ""
    echo "[4] Testing download..."
    DOWNLOAD_URL=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('downloadUrl',''))" 2>/dev/null)
    curl -s -o /tmp/test_download.mp4 "$BASE_URL$DOWNLOAD_URL"
    FILE_SIZE=$(stat -c%s /tmp/test_download.mp4 2>/dev/null || echo 0)

    [ "$FILE_SIZE" -gt "10000" ] 2>/dev/null && pass "Download works ($FILE_SIZE bytes)" || fail "Download failed or too small"
  fi
fi

# Test 5: Rate limiting
echo ""
echo "[5] Testing rate limiting..."
sleep 61  # Wait for rate limit window to reset
RL1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/render" -H "Content-Type: application/json" -d '{"script":{"id":"rl1","url":"http://localhost:3099/test-site.html","viewport":{"width":640,"height":360},"fps":12,"outputFormat":"mp4","createdAt":"2024-01-01","steps":[{"id":"1","order":1,"target":null,"targetLabel":"x","action":"wait","duration":0.3}]}}')
RL2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/render" -H "Content-Type: application/json" -d '{"script":{"id":"rl2","url":"http://localhost:3099/test-site.html","viewport":{"width":640,"height":360},"fps":12,"outputFormat":"mp4","createdAt":"2024-01-01","steps":[{"id":"1","order":1,"target":null,"targetLabel":"x","action":"wait","duration":0.3}]}}')
RL3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/render" -H "Content-Type: application/json" -d '{"script":{"id":"rl3","url":"http://localhost:3099/test-site.html","viewport":{"width":640,"height":360},"fps":12,"outputFormat":"mp4","createdAt":"2024-01-01","steps":[{"id":"1","order":1,"target":null,"targetLabel":"x","action":"wait","duration":0.3}]}}')
RL4=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/render" -H "Content-Type: application/json" -d '{"script":{"id":"rl4","url":"http://localhost:3099/test-site.html","viewport":{"width":640,"height":360},"fps":12,"outputFormat":"mp4","createdAt":"2024-01-01","steps":[{"id":"1","order":1,"target":null,"targetLabel":"x","action":"wait","duration":0.3}]}}')

echo "  Requests: $RL1, $RL2, $RL3, $RL4"
[ "$RL4" = "429" ] && pass "Rate limiting works (4th request blocked)" || fail "Rate limiting not working (got $RL4, expected 429)"

# Test 6: Invalid input
echo ""
echo "[6] Testing error handling..."
ERR_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/capture" -H "Content-Type: application/json" -d '{"url": "not-a-url"}')
[ "$ERR_RESPONSE" = "500" ] || [ "$ERR_RESPONSE" = "400" ] && pass "Invalid URL returns error ($ERR_RESPONSE)" || fail "Invalid URL: expected 4xx/5xx, got $ERR_RESPONSE"

ERR_JOB=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/job/nonexistent-job-id")
[ "$ERR_JOB" = "404" ] && pass "Missing job returns 404" || fail "Missing job: expected 404, got $ERR_JOB"

ERR_DL=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/download/nonexistent-job-id")
[ "$ERR_DL" = "404" ] && pass "Missing download returns 404" || fail "Missing download: expected 404, got $ERR_DL"

# Summary
echo ""
echo "================================"
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo "================================"
[ "$FAIL" -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
