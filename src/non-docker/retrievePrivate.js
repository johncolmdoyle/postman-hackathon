const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME || '';
const COLUMN_KEY = process.env.COLUMN_KEY || '';

exports.handler = async (event, context, callback) => {
  const apiKey = event.requestContext.identity.apiKey;
  if (!apiKey) {
    return { statusCode: 400, body: `Error: You are missing the API key in the header` };
  }

  const params = {
    TableName: TABLE_NAME,
    FilterExpression: "#apiKey = :apiKeyValue",
    ExpressionAttributeNames:{
        "#apiKey": COLUMN_KEY
    },
    ExpressionAttributeValues: {
        ":apiKeyValue": apiKey
    }
  };

  try {
    const response = await db.scan(params).promise();
    return { statusCode: 200, body: JSON.stringify(response.Items) };
  } catch (dbError) {
    return { statusCode: 500, body: JSON.stringify(dbError) };
  }
};

