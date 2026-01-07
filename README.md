# Cloud Function for the nightlydigest API
This cloud function does some logic to get the last exposure from the nightly digest api

See [here](https://phalanx.lsst.io/environments/usdfdev/index.html#std-px-env-usdfdev) for more info on the nightlydigest documentation (but there may be a better link)

## Architecture
Planned architecture
```mermaid
graph LR
    subgraph RedisClient
        nightly-digest-stats["/nightly-digest-stats"]-->redis-current-stats["/current-stats"]
        
    end


    subgraph nightlydigest
        nightlydigestapi
    end

    subgraph nightlydigestclient
        nightlydigest-stats["/nightlydigest-stats"]
    end

    subgraph Hasura
        nightlydigestRedisData
        
    end
    nightlydigestapi-->nightlydigest-stats-->nightly-digest-stats
    redis-current-stats-->nightlydigestRedisData
    Hasura-->graphQL
    
```

## Deployment

First, build the typescript:

```
yarn build
```

The above command will create a `/dist` folder with the built Javascript.

Ensure you've populated the `.env.yaml` for Google Cloud Functions v2 deployment.

Then, ensure your `gcloud` CLI is pointed at the correct GCP project and deploy the cloud function:

```
sh deploy.sh
```

## Development
### Start Development Server
Run local development server
```
yarn run start-dev
```

### Testing
Run tests
```
yarn run test
```

To generate a code coverage report:
```
yarn run test -- --coverage
```

