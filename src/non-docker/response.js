const AWS = require('aws-sdk');
const axios = require('axios');
const jp = require('jsonpath');

const db = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const SORT_KEY = process.env.SORT_KEY || '';

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


exports.handler = async (event, context) => {
  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  for (const record of event.Records) {
    item[PRIMARY_KEY] = record.dynamodb.NewImage.initId.S;
    item[SORT_KEY] = 'response';
    item['regionFunction'] = process.env.AWS_REGION;
    item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
    item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();
    item['lambdaRequestId'] = context.awsRequestId;

    try{
        const requestInfo = requestData(record.dynamodb.NewImage.apiUrl.S);
        const dataResponse = await Promise.all([requestInfo]);
        item['response'] = {};
        item['response']['status'] = dataResponse[0].status;
        item['response']['statusText'] = dataResponse[0].statusText;
        item['response']['headers'] = dataResponse[0].headers;
        item['response']['config'] = dataResponse[0].config;
        item['response']['latency'] = dataResponse[0].responseTime;

        if (record.dynamodb.NewImage.hasOwnProperty('jsonPath')) {
          const jsonPath = "" + record.dynamodb.NewImage.jsonPath.S;
          let responseBody = jp.query(dataResponse[0].data, jsonPath);
          let responseDataSize = Buffer.byteLength(JSON.stringify(responseBody), "utf8");
          if (responseDataSize < 50000) {
            item['response']['data'] = responseBody;
          } else {
            console.log("Response too large");
          }
        }
    }catch(err){
        console.error(err);
    }
  
    const params = {
      TableName: TABLE_NAME,
      Item: item
    };
  
    try {
      await db.put(params).promise();
    } catch (dbError) {
      console.log(dbError);
    }
  }
};

