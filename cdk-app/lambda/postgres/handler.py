import json
import logging
import os

import boto3
import psycopg2

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _database_credentials():
    client_options = {}
    endpoint = os.environ.get("SECRETS_MANAGER_ENDPOINT")
    if endpoint:
        client_options["endpoint_url"] = endpoint

    secret_id = os.environ["DB_SECRET_ID"]
    response = boto3.client("secretsmanager", **client_options).get_secret_value(
        SecretId=secret_id
    )
    secret = json.loads(response["SecretString"])

    required_fields = ("host", "database", "username", "password")
    missing_fields = [field for field in required_fields if not secret.get(field)]
    if missing_fields:
        raise ValueError(f"Database secret is missing fields: {', '.join(missing_fields)}")

    return secret


def lambda_handler(event, context):
    connection = None
    cursor = None

    try:
        credentials = _database_credentials()
        connection = psycopg2.connect(
            host=credentials["host"],
            database=credentials["database"],
            user=credentials["username"],
            password=credentials["password"],
            port=int(credentials.get("port", 5432)),
            connect_timeout=5,
        )
        cursor = connection.cursor()
        cursor.execute("SELECT id, name FROM users LIMIT 10;")
        records = cursor.fetchall()

        data = [{"id": row[0], "name": row[1]} for row in records]
        return {"statusCode": 200, "body": json.dumps(data, default=str)}
    except Exception as error:
        logger.error("PostgreSQL read failed: %s", type(error).__name__)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "Failed to read data"}),
        }
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None:
            connection.close()
