gcloud run deploy nightlydigest-client \
    --source . \
    --function nightlydigest-stats \
    --region us-west1 \
    --base-image nodejs24 \
    --allow-unauthenticated \
    --execution-environment gen2 \
    --env-vars-file .env.yaml