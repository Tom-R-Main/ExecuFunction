#!/bin/bash
# Setup script for Cloud SQL database

PROJECT_ID="skilled-axis-472019-t7"
INSTANCE_NAME="exf-core-pg"
DB_NAME="execufunction"
DB_USER="app_user"

echo "Waiting for Cloud SQL instance to be ready..."
gcloud sql operations wait --project=$PROJECT_ID \
  $(gcloud sql operations list --instance=$INSTANCE_NAME --project=$PROJECT_ID --limit=1 --format="value(name)")

echo "Creating database..."
gcloud sql databases create $DB_NAME \
  --instance=$INSTANCE_NAME \
  --project=$PROJECT_ID

echo "Creating user..."
gcloud sql users create $DB_USER \
  --instance=$INSTANCE_NAME \
  --password=$(openssl rand -base64 32) \
  --project=$PROJECT_ID

echo "Database setup complete!"
echo "Connection name: $PROJECT_ID:us-central1:$INSTANCE_NAME"