#!/bin/bash

# Azure Storage setup for Executive Function waitlist/contact system
# Run this after deploying the Static Web App

set -e

# Configuration
RG="rg-exf-prod"
LOC="centralus"
APP_NAME="exf-web"

# Generate unique storage account name (must be globally unique)
RANDOM_SUFFIX=$((RANDOM % 9999))
ST="stexecufunction${RANDOM_SUFFIX}"

echo "Setting up Azure Storage for Executive Function..."
echo "Resource Group: $RG"
echo "Location: $LOC"
echo "Storage Account: $ST"
echo ""

# 1) Create storage account
echo "Creating storage account..."
az storage account create \
  -g "$RG" \
  -n "$ST" \
  -l "$LOC" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --access-tier Hot

# 2) Get storage key
echo "Retrieving storage key..."
KEY=$(az storage account keys list -g "$RG" -n "$ST" --query "[0].value" -o tsv)

# 3) Create tables
echo "Creating tables..."
az storage table create --name waitlist --account-name "$ST" --account-key "$KEY"
az storage table create --name contact --account-name "$ST" --account-key "$KEY"
az storage table create --name throttle --account-name "$ST" --account-key "$KEY"
az storage table create --name suppression --account-name "$ST" --account-key "$KEY"

# 4) Build connection string
CONN="DefaultEndpointsProtocol=https;AccountName=$ST;AccountKey=$KEY;EndpointSuffix=core.windows.net"

# 5) Configure Static Web App settings
echo "Configuring Static Web App settings..."
az staticwebapp appsettings set \
  -n "$APP_NAME" \
  -g "$RG" \
  --setting-names \
    STORAGE_CONNECTION_STRING="$CONN" \
    CONTACT_TO="tom@winonaos.com"

echo ""
echo "✅ Storage setup complete!"
echo ""
echo "Admin export endpoint:"
echo "After deployment, get your function key from the Azure Portal:"
echo "1. Go to your Static Web App in the portal"
echo "2. Navigate to Functions"
echo "3. Find 'admin-export' and get the function key"
echo "4. Access CSV export at:"
echo "   https://execufunction.com/api/admin/export?code=YOUR_FUNCTION_KEY"
echo ""
echo "Optional parameters for export:"
echo "  - &table=waitlist (default) or &table=contact"
echo "  - &from=2025-09 (start month)"
echo "  - &to=2025-12 (end month)"
echo ""
echo "Example:"
echo "  https://execufunction.com/api/admin/export?code=KEY&table=waitlist&from=2025-09&to=2025-12"