const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';

exports.handler = async (event, context, callback) => {
  const requestedItemId = event.pathParameters.id;
  if (!requestedItemId) {
    return { statusCode: 400, body: `Error: You are missing the path parameter id` };
  }

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "#primaryKey = :id",
    ExpressionAttributeNames:{
        "#primaryKey": PRIMARY_KEY
    },
    ExpressionAttributeValues: {
        ":id": requestedItemId
    }
  };

  try {
    const response = await db.query(params).promise();
    return { statusCode: 200, body: JSON.stringify(response.Items) };
  } catch (dbError) {
    return { statusCode: 500, body: JSON.stringify(dbError) };
  }
};

