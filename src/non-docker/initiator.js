const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient();
const {"v4": uuidv4} = require('uuid');
const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

exports.handler = async (event, context, callback) => {
  if (!event.body) {
    return { statusCode: 400, body: 'invalid request, you are missing the parameter body' };
  }

  const userData = typeof event.body == 'object' ? event.body : JSON.parse(event.body);

  if (!userData.apiUrl) {
    return { statusCode: 400, body: 'invalid request, no apiUrl included in the paramater body.' };
  }

  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  item[PRIMARY_KEY] = uuidv4();
  item['apiUrl'] = userData.apiUrl;
  item['initRegion'] = process.env.AWS_REGION;
  item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
  item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();
  item['lambdaRequestId'] = context.awsRequestId;

  const params = {
    TableName: TABLE_NAME,
    Item: item
  };

  try {
    await db.put(params).promise();

    // Remove trace info
    delete item['lambdaRequestId'];
    delete item['initRegion'];

    return { statusCode: 201, body: JSON.stringify(item) };
  } catch (dbError) {
    const errorResponse = dbError.code === 'ValidationException' && dbError.message.includes('reserved keyword') ?
    DYNAMODB_EXECUTION_ERROR : RESERVED_RESPONSE;
    return { statusCode: 500, body: errorResponse };
  }
};
