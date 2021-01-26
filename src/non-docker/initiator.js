const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient();
const axios = require('axios');
const {"v4": uuidv4} = require('uuid');
const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

async function requestData(url){
    return new Promise((resolve, reject) => {
      axios.interceptors.request.use( x => {
        x.meta = x.meta || {}
        x.meta.requestStartedAt = new Date().getTime();
        return x;
      });

      axios.interceptors.response.use( x => {
        x.responseTime = new Date().getTime() - x.config.meta.requestStartedAt;
        return x;
      });

      axios.get(url)
        .then(function (response) {
          resolve(response);
        })
        .catch(err => reject(err))
  });
};

exports.handler = async (event, context, callback) => {
  if (!event.body) {
    return { statusCode: 400, body: 'invalid request, you are missing the parameter body' };
  }

  const userData = typeof event.body == 'object' ? event.body : JSON.parse(event.body);

  if (!userData.apiUrl) {
    return { statusCode: 400, body: 'invalid request, no apiUrl included in the paramater body.' };
  }

  const requestInfo = requestData(userData.apiUrl);
  const dataResponse = await Promise.all([requestInfo]);

  if (Number(dataResponse[0].status) < 200 || Number(dataResponse[0].status) > 299) {
    return { statusCode: 400, body: 'invalid request, apiUrl responded with status code: ' + dataResponse[0].status + '. Expected a number between 200-299'};
  }

  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  item[PRIMARY_KEY] = uuidv4();
  item['apiUrl'] = userData.apiUrl;
  item['initRegion'] = process.env.AWS_REGION;
  item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
  item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();
  item['lambdaRequestId'] = context.awsRequestId;
  item['apiKey'] = event.requestContext.identity.apiKey;
  item['sourceIp'] = event.requestContext.identity.sourceIp;

  if (userData.hasOwnProperty('jsonPath')) {
    item['jsonPath'] = userData.jsonPath;
  }

  const params = {
    TableName: TABLE_NAME,
    Item: item
  };

  try {
    await db.put(params).promise();

    // Remove trace info
    item['testId'] = item[PRIMARY_KEY];
    delete item[PRIMARY_KEY];
    delete item['lambdaRequestId'];
    delete item['initRegion'];
    delete item['apiKey'];
    delete item['sourceIp'];

    return { statusCode: 201, body: JSON.stringify(item) };
  } catch (dbError) {
    const errorResponse = dbError.code === 'ValidationException' && dbError.message.includes('reserved keyword') ?
    DYNAMODB_EXECUTION_ERROR : RESERVED_RESPONSE;
    return { statusCode: 500, body: errorResponse };
  }
};
