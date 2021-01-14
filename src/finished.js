const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const SORT_KEY = process.env.SORT_KEY || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

exports.handler = async (event, context) => {
  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  for (const record of event.Records) {
    item[PRIMARY_KEY] = record.dynamodb.NewImage.initId.S;
    item[SORT_KEY] = process.env.AWS_REGION;
    item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
    item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();
  }

  const params = {
    TableName: TABLE_NAME,
    Item: item
  };

  console.log(JSON.stringify(params));

  try {
    await db.put(params).promise();
    return { statusCode: 201, body: JSON.stringify(item) };
  } catch (dbError) {
    const errorResponse = dbError.code === 'ValidationException' && dbError.message.includes('reserved keyword') ?
    DYNAMODB_EXECUTION_ERROR : RESERVED_RESPONSE;
    return { statusCode: 500, body: errorResponse };
  }
};

