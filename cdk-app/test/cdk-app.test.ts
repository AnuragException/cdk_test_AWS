import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CdkAppStack } from '../lib/cdk-app-stack';

test('S3 object creation invokes the Lambda function', () => {
  const app = new cdk.App();
  const stack = new CdkAppStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'handler.lambda_handler',
    Runtime: 'python3.12',
  });
  template.hasResourceProperties('AWS::S3::Bucket', {
    NotificationConfiguration: Match.objectLike({
      LambdaConfigurations: Match.arrayWith([
        Match.objectLike({ Event: 's3:ObjectCreated:*' }),
      ]),
    }),
  });
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Action: 'lambda:InvokeFunction',
    Principal: 's3.amazonaws.com',
  });
});
