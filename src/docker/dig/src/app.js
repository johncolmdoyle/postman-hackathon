"use strict";
const dig = require('node-dig-dns');
const AWS = require('aws-sdk');

const db = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const SORT_KEY = process.env.SORT_KEY || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

function digInfo(domain) {
  return new Promise((resolve) => {
    dig([domain, 'ANY']).then((result) => {
      resolve(result)
    })
    .catch((err) => {
      reject(err);
    });
  });
} 

exports.handler = async (event, context) => {
  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  for (const record of event.Records) {
    item[PRIMARY_KEY] = record.dynamodb.NewImage.initId.S;
    item[SORT_KEY] = 'dig';

    item['lambdaRequestId'] = context.awsRequestId;
    item['regionFunction'] = process.env.AWS_REGION;

    item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
    item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();

    let url = new URL(record.dynamodb.NewImage.apiUrl.S);

    const response = digInfo(url.hostname);
    const dataResponse = await Promise.all([response]);

    item['dig'] = dataResponse[0];

    const params = {
      TableName: TABLE_NAME,
      Item: item
    };

    try {
      await db.put(params).promise();
    } catch (dbError) {
      const errorResponse = dbError.code === 'ValidationException' && dbError.message.includes('reserved keyword') ?
      DYNAMODB_EXECUTION_ERROR : RESERVED_RESPONSE;
    }
  }
}
