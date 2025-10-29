#!/bin/bash
# build.sh - Build WebTime extension with automatic testing

set -e  # Exit immediately if tests fail

echo "🧪 Running φ-nudge tests..."
echo ""
node test-phi-nudges-v2.js

if [ $? -eq 0 ]; then
    echo ""
    echo "📦 Building extension..."
    web-ext build --source-dir extension --artifacts-dir artifacts --overwrite-dest
else
    echo ""
    echo "❌ Tests failed! Build aborted."
    exit 1
fi
