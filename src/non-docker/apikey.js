const AWS = require('aws-sdk');

const db = new AWS.DynamoDB.DocumentClient();
const apigateway = new AWS.APIGateway({apiVersion: '2015-07-09'});

const USAGE_PLAN_ID = process.env.USAGE_PLAN_ID || '';
const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';

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

async function deleteApiKey(params){
    return new Promise((resolve, reject) => {
      apigateway.deleteApiKey(params, function(err, data) {
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
    
    if (record.hasOwnProperty('eventName') && record.eventName === "INSERT") {
      const createdAt = (Math.floor(+new Date() / 1000)).toString();

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

      const keyData = {};
      keyData[PRIMARY_KEY] = cognitoIdentityId;

      const insertParams = {
        TableName: TABLE_NAME,
        Key: keyData,
        UpdateExpression: "set createdAt = :createdAt, #apiKeyId = :apiKeyId",
        ExpressionAttributeNames: {
          "#apiKeyId": "apiKeyId"
        },
        ExpressionAttributeValues: {
          ":createdAt": createdAt,
          ":apiKeyId": dataResponse[0].id
        }
      };

      try {
        await db.update(insertParams).promise();
      } catch (dbError) {
        console.log(JSON.stringify(dbError))
      }
    } else if (record.hasOwnProperty('eventName') && record.eventName === "REMOVE") {
      const cognitoIdentityId = record.dynamodb.OldImage.cognitoIdentityId.S;

      const keyData = {};
      keyData[PRIMARY_KEY] = cognitoIdentityId;

      let getParams = {
        TableName : TABLE_NAME,
        Key: keyData
      };

      try {
        const data = await db.get(getParams).promise();

        console.log(JSON.stringify(data));

        var deleteParams = {
          apiKey: data.Item.apiKeyId
        };
        
        const deleteAPIRequest = deleteApiKey(deleteParams);
        const deleteAPIResponse = await Promise.all([deleteAPIRequest]);
      } catch (dbError) {
        console.log(JSON.stringify(dbError))
      }
    }
  }
};

