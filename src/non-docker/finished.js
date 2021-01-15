const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

exports.handler = async (event, context) => {
  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  for (const record of event.Records) {
    const primaryKeyValue = record.dynamodb.NewImage.initId.S;
    const regionData = record.dynamodb.NewImage.regionFunction.S;
    const functionName = record.dynamodb.NewImage.functionCall.S;
    const createdAt = (Math.floor(+new Date() / 1000)).toString();
    const ttl = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();
    
    const functionOutput = [];

    switch(functionName) {
      case 'traceroute':
        functionOutput.push(AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage.traceroute.L));
        break;
      case 'nslookup':
        if (record.dynamodb.NewImage.hasOwnProperty('lookup')) {
          functionOutput.push(AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage.lookup.L));
        }
        if (record.dynamodb.NewImage.hasOwnProperty('resolve4')) {
          functionOutput.push(AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage.resolve4.L));
        }
        if (record.dynamodb.NewImage.hasOwnProperty('resolve4')) {
          functionOutput.push(AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage.resolve6.L));
        }
        if (record.dynamodb.NewImage.hasOwnProperty('resolveAny')) {
          functionOutput.push(AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage.resolveAny.L));
        }
        break;
    }

    const keyData = {};
    keyData[PRIMARY_KEY] = record.dynamodb.NewImage.initId.S;
    keyData['region'] = regionData;
    
    const params = {
      TableName: TABLE_NAME,
      Key: keyData,
      UpdateExpression: "set createdAt = :createdAt, #ttlData = :ttl, #NetworkFunction = :functionOutput",
      ExpressionAttributeNames: {
        "#NetworkFunction": functionName,
        "#ttlData": "ttl"
      },
      ExpressionAttributeValues: {
        ":createdAt": createdAt,
        ":ttl": ttl,
        ":functionOutput": functionOutput
      }
    };
    
    try {
      await db.update(params).promise();
    } catch (dbError) {
      console.log(JSON.stringify(dbError))
    }
  }
};
