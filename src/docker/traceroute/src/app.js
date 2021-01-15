"use strict";
const traceroute = require('traceroute');
const AWS = require('aws-sdk');
const ipRangeCheck = require("ip-range-check");
const fs = require('fs');

const db = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const SORT_KEY = process.env.SORT_KEY || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

function trace(domain) {
  return new Promise((resolve) => {
    traceroute.trace(domain, function (err,hops) {
      if (!err) resolve(hops);
    });
  });
} 

function getAWSDetails(ipAddress) {
  return new Promise((resolve) => {
    fs.readFile('ip-ranges.json', (err, data) => {
      if (err) throw err;
      let cidrData = JSON.parse(data);

      cidrData.prefixes.forEach(function(prefix) {
        if (ipRangeCheck(ipAddress, prefix.ip_prefix)) {
          resolve(prefix);
        }
      });

      resolve();
    });
  });
}

exports.handler = async (event, context) => {
  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  for (const record of event.Records) {
    item[PRIMARY_KEY] = record.dynamodb.NewImage.initId.S;
    item[SORT_KEY] = 'traceroute';

    item['lambdaRequestId'] = context.awsRequestId;
    item['regionFunction'] = process.env.AWS_REGION;

    item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
    item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();

    let url = new URL(record.dynamodb.NewImage.apiUrl.S);

    try{
        const response = trace(url.hostname);
        const dataResponse = await Promise.all([response]);

        let hopData = [];

        let hopCount = 1;

        let noICMPCount = 0;

        for (const index in dataResponse[0]) {
          const value = dataResponse[0][index];
          console.log(JSON.stringify(value));

          if (!value) {
            noICMPCount++;
            if (noICMPCount > 4) {
              break;
            }
          } else {
            noICMPCount = 0;
            let hopObj = {};

            hopObj['hop'] = hopCount;
            hopObj['ip'] = Object.keys(value)[0];
            hopObj['rrt'] = Object.keys(value).map(key => value[key][0])[0];

            const awsData = getAWSDetails(Object.keys(value)[0]);
            const awsDataResponse = await Promise.all([awsData]);
            hopObj['aws'] = awsDataResponse[0];

            hopData.push(hopObj);
            hopCount++;
          }
        }

        item['traceroute'] = hopData;
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
      const errorResponse = dbError.code === 'ValidationException' && dbError.message.includes('reserved keyword') ?
      DYNAMODB_EXECUTION_ERROR : RESERVED_RESPONSE;
    }
  }
}
