const AWS = require('aws-sdk');

const apigateway = new AWS.APIGateway({apiVersion: '2015-07-09'});

const USAGE_PLAN_ID = process.env.USAGE_PLAN_ID || '';

async function addToUsagePlan(params){
    return new Promise((resolve, reject) => {
      apigateway.createUsagePlanKey(params, function(err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else {
              resolve(data);
            }
      });
    });
};

async function createApiKey(params){
    return new Promise((resolve, reject) => {
      apigateway.createApiKey(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else {
          resolve(data);
        }
      });
   });
};

exports.handler = async (event, context) => {
  for (const record of event.Records) {
    console.log(JSON.stringify(record));
    
    let cognitoIdentityId = record.dynamodb.NewImage.cognitoIdentityId.S;
    let name = record.dynamodb.NewImage.name.S;
    let key = record.dynamodb.NewImage.key.S
    let userId = record.dynamodb.NewImage.userId.S;
    let description = record.dynamodb.NewImage.description.S;
    let enabled = record.dynamodb.NewImage.enabled.BOOL;
    let usagePlanName = record.dynamodb.NewImage.usagePlanName.S;

    var params = {
      customerId: userId,
      description: description,
      enabled: enabled,
      name: name,
      tags: {
        'app': 'postman-hackathon',
        'cognitoIdentityId': cognitoIdentityId
      },
      value: key
    };
    
  
    const apiKeyCreateRequest = createApiKey(params);
    const dataResponse = await Promise.all([apiKeyCreateRequest]);
    
    var addParams = {
      keyId: dataResponse[0].id,
      keyType: 'API_KEY',
      usagePlanId: USAGE_PLAN_ID
    };
    
    const usagePlanRequest = addToUsagePlan(addParams);
    const usageResponse = await Promise.all([usagePlanRequest]);
  }
};

