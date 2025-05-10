#!/bin/bash

# Update package repository
apt-get update

# Install required dependencies for Poppler
apt-get install -y poppler-utils poppler-data

# Install Node.js dependencies
npm install

echo "Build completed successfully" 