#!/bin/bash

# Simple deployment script
# Usage: ./deploy.sh v1.0.3

# Configuration
DOCKER_USERNAME="emqarani3"
DOCKER_REPO="crypto-exchange-bc"
IMAGE_NAME="btc-backend"

# Check if tag is provided
if [ -z "$1" ]; then
    echo "❌ Error: No tag provided!"
    echo "Usage: ./deploy.sh <tag>"
    echo "Example: ./deploy.sh v1.0.3"
    exit 1
fi

TAG=$1

echo "🚀 Starting deployment..."
echo "Tag: $TAG"
echo ""

# Build
echo "📦 Building Docker image..."
docker build -t $IMAGE_NAME . || { echo "❌ Build failed!"; exit 1; }

# Tag
echo "🏷️  Tagging image..."
docker tag $IMAGE_NAME:latest $DOCKER_USERNAME/$DOCKER_REPO:$TAG || { echo "❌ Tag failed!"; exit 1; }

# Push
echo "☁️  Pushing to Docker Hub..."
docker push $DOCKER_USERNAME/$DOCKER_REPO:$TAG || { echo "❌ Push failed!"; exit 1; }

echo ""
echo "✅ Deployment completed successfully!"
echo "Image: $DOCKER_USERNAME/$DOCKER_REPO:$TAG"
echo ""