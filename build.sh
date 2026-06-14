#!/bin/bash
# build.sh - Build WebTime extension with automatic testing

set -e  # Exit immediately if a command fails

echo "🔷 Compiling TypeScript..."
npm run build

echo ""
echo "🧪 Running tests..."
echo ""
npm test

if [ $? -eq 0 ]; then
    echo ""
    echo "📦 Building extension..."
    npx web-ext build --source-dir extension --artifacts-dir artifacts --overwrite-dest
else
    echo ""
    echo "❌ Tests failed! Build aborted."
    exit 1
fi
