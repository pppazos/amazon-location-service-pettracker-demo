const AWSXRay = require('aws-xray-sdk-core')
const AWS = AWSXRay.captureAWS(require('aws-sdk'))
const AWSAppSyncClient = require('aws-appsync').default;
const gql = require('graphql-tag');
require('cross-fetch/polyfill');
require('isomorphic-fetch');

const queryGQL = gql(require('./graphql/queries').getLocation);
const createGQL = gql(require('./graphql/mutations').createLocation);
const updateGQL = gql(require('./graphql/mutations').updateLocation);

const region = process.env.REGION

AWS.config.update({
    region
});
const SSM = new AWS.SSM();

const parameterPromise = SSM.getParameter({Name: 'PetTrackerGraphQLEndpoint'}).promise();
const credentials = AWS.config.credentials;

/**
 *
 * @param {*} event event body, format:
 * { "deviceid": "thing123", 
 *  "timestamp": 1604940328,
 *  "location": {
 *   "lat": 49.2819, 
 *   "long": -123.1187
 *  }
 * }
 * @returns
 */
exports.handler = (event) => {

    console.log('event received:' + JSON.stringify(event));

    return parameterPromise.then(function (data, err) {
        if (err) {
            console.error(err)
            throw err
        } else return data.Parameter.Value;
    }).then(function (endpoint) {
        console.log('SSM Parameter value:' + endpoint);

        return new AWSAppSyncClient({
                url: endpoint,
                region: region,
                auth: {
                    type: 'AWS_IAM',
                    credentials: credentials,
                },
                disableOffline: true,
            },
            {
                defaultOptions: {
                    query: {
                        fetchPolicy: 'network-only',
                        errorPolicy: 'all',
                    },
                },
            }
        ).hydrated();
    }).then(function (cl) {
        console.log('Searching for an existing device');
        return cl.query({
            query: queryGQL,
            variables: {
                id: event.deviceid
            }
        }).then(function (queryResult) {
            console.log('Query result:' + JSON.stringify(queryResult.data));
            if (queryResult.data.getLocation) {
                console.log('Updating existing device');
                return cl.mutate({
                    mutation: updateGQL,
                    variables: {
                        input: {
                            id: event.deviceid,
                            lat: event.location.lat,
                            long: event.location.long
                        }
                    }
                });
            } else {
                console.log('Creating new device');
                return cl.mutate({
                    mutation: createGQL,
                    variables: {
                        input: {
                            id: event.deviceid,
                            lat: event.location.lat,
                            long: event.location.long
                        }
                    }
                });
            }
        })

    }).then(() => {
        return {
            statusCode: 200
        }
    })
        .catch(error => {
            console.error(error)
            return {
                statusCode: error.statusCode ? error.statusCode : 500
            }
        });
}