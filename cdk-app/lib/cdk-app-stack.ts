import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaDestinations from 'aws-cdk-lib/aws-s3-notifications';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

export class CdkAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'LearningBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new lambda.Function(this, 'HelloFunction', {
      functionName: 'cdk-s3-event-handler',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
    });

    const urllib3Layer = new lambda.LayerVersion(this, 'Urllib3Layer', {
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'urllib3 dependency for the httpbin Lambda',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/urllib3-layer'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash',
            '-c',
            'mkdir -p /asset-output/python && pip install -r requirements.txt -t /asset-output/python',
          ],
        },
      }),
    });

    const httpbinFunction = new lambda.Function(this, 'HttpbinFunction', {
      functionName: 'httpbin-get',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/httpbin')),
      layers: [urllib3Layer],
      timeout: cdk.Duration.seconds(15),
    });

    const postgresLayer = new lambda.LayerVersion(this, 'PostgresLayer', {
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'psycopg2 dependency for the PostgreSQL reader Lambda',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/postgres-layer'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash',
            '-c',
            'mkdir -p /asset-output/python && pip install -r requirements.txt -t /asset-output/python',
          ],
        },
      }),
    });

    const postgresSecretName = 'practice-postgres-credentials';
    const postgresSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'PostgresCredentials',
      postgresSecretName,
    );
    const dbFunction = new lambda.Function(this, 'PostgresReaderFunction', {
      functionName: 'practice-postgres-reader',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/postgres')),
      layers: [postgresLayer],
      environment: {
        DB_SECRET_ID: postgresSecretName,
        ...(process.env.FLOCI_INTERNAL_ENDPOINT
          ? { SECRETS_MANAGER_ENDPOINT: process.env.FLOCI_INTERNAL_ENDPOINT }
          : {}),
      },
      timeout: cdk.Duration.seconds(15),
    });
    postgresSecret.grantRead(dbFunction);

    const vpc = new ec2.Vpc(this, 'Ec2Vpc', {
      maxAzs: 1,
      natGateways: 0,
      restrictDefaultSecurityGroup: false,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const instanceSecurityGroup = new ec2.SecurityGroup(this, 'Ec2SecurityGroup', {
      vpc,
      description: 'Security group for the CDK learning EC2 instance',
      allowAllOutbound: true,
    });

    const sshKeyPairName = process.env.EC2_SSH_KEY_PAIR_NAME;
    const sshCidr = process.env.EC2_SSH_CIDR;
    if (Boolean(sshKeyPairName) !== Boolean(sshCidr)) {
      throw new Error('Set both EC2_SSH_KEY_PAIR_NAME and EC2_SSH_CIDR to enable SSH.');
    }
    if (sshCidr) {
      instanceSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(sshCidr),
        ec2.Port.tcp(22),
        'Allow SSH from the configured client CIDR',
      );
    }

    const apiCidr = process.env.EC2_API_CIDR ?? sshCidr;
    if (apiCidr) {
      instanceSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(apiCidr),
        ec2.Port.tcp(8080),
        'Allow the weather API from the configured client CIDR',
      );
    }

    const instanceRole = new iam.Role(this, 'Ec2InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    );
    postgresSecret.grantRead(instanceRole);

    const weatherApiPath = path.join(__dirname, '../ec2/weather_api.py');
    const requirementsPath = path.join(__dirname, '../ec2/weather-api-requirements.txt');
    const weatherApiSource = fs.readFileSync(weatherApiPath, 'utf8');
    const weatherRequirements = fs.readFileSync(requirementsPath, 'utf8');
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euo pipefail',
      'dnf install -y python3 python3-pip shadow-utils',
      'mkdir -p /opt/weather-api',
      `printf '%s' '${Buffer.from(weatherApiSource).toString('base64')}' | base64 -d > /opt/weather-api/app.py`,
      `printf '%s' '${Buffer.from(weatherRequirements).toString('base64')}' | base64 -d > /opt/weather-api/requirements.txt`,
      'python3 -m venv /opt/weather-api/venv',
      '/opt/weather-api/venv/bin/pip install --disable-pip-version-check -r /opt/weather-api/requirements.txt',
      'useradd --system --no-create-home --shell /sbin/nologin weather-api',
      'chown -R weather-api:weather-api /opt/weather-api',
      'nohup runuser -u weather-api -- /opt/weather-api/venv/bin/gunicorn --workers 2 --bind 0.0.0.0:8080 --chdir /opt/weather-api app:app >> /var/log/weather-api.log 2>&1 < /dev/null &',
    );

    const weatherApiFunction = new lambda.Function(this, 'WeatherApiProxyFunction', {
      functionName: 'weather-api-proxy',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/weather-proxy')),
      environment: process.env.WEATHER_API_URL
        ? { WEATHER_API_URL: process.env.WEATHER_API_URL }
        : {},
      timeout: cdk.Duration.seconds(15),
    });

    const ec2Instance = new ec2.Instance(this, 'LearningEc2Instance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: instanceSecurityGroup,
      role: instanceRole,
      associatePublicIpAddress: true,
      requireImdsv2: true,
      userData,
      userDataCausesReplacement: true,
      ...(sshKeyPairName
        ? { keyPair: ec2.KeyPair.fromKeyPairName(this, 'LearningKeyPair', sshKeyPairName) }
        : {}),
    });

    bucket.grantReadWrite(fn);
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new lambdaDestinations.LambdaDestination(fn),
    );

    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'FunctionName', { value: fn.functionName });
    new cdk.CfnOutput(this, 'HttpbinFunctionName', { value: httpbinFunction.functionName });
    new cdk.CfnOutput(this, 'PostgresFunctionName', { value: dbFunction.functionName });
    new cdk.CfnOutput(this, 'WeatherApiFunctionName', {
      value: weatherApiFunction.functionName,
    });
    new cdk.CfnOutput(this, 'Ec2InstanceId', { value: ec2Instance.instanceId });
    new cdk.CfnOutput(this, 'Ec2PublicIp', { value: ec2Instance.instancePublicIp });
    new cdk.CfnOutput(this, 'Ec2VpcId', { value: vpc.vpcId });
    new cdk.CfnOutput(this, 'Ec2SecurityGroupId', {
      value: instanceSecurityGroup.securityGroupId,
    });
    new cdk.CfnOutput(this, 'WeatherApiPort', { value: '8080' });
  }
}