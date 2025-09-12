#!/bin/bash
# Run this in Azure Cloud Shell to set up storage for waitlist

RG="rg-exf-prod"
STORAGE_NAME="stexecufunction$RANDOM"

echo "Creating storage account: $STORAGE_NAME"
az storage account create \
  -g "$RG" \
  -n "$STORAGE_NAME" \
  -l centralus \
  --sku Standard_LRS

echo "Getting connection string..."
CONNECTION_STRING=$(az storage account show-connection-string \
  -g "$RG" \
  -n "$STORAGE_NAME" \
  --query connectionString -o tsv)

echo "Creating waitlist table..."
az storage table create \
  --name waitlist \
  --connection-string "$CONNECTION_STRING"

echo ""
echo "✅ Storage setup complete!"
echo ""
echo "Add this to your SWA Application Settings:"
echo "STORAGE_CONNECTION_STRING = $CONNECTION_STRING"
echo ""
echo "Storage Account: $STORAGE_NAME"