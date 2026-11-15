import json
import logging
import math
import os
from contextlib import closing

import boto3
import psycopg2
from flask import Flask, jsonify, request
from psycopg2.extras import RealDictCursor

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SECRET_ID = os.environ.get("WEATHER_DB_SECRET", "practice-postgres-credentials")
TABLE_SQL = """
CREATE TABLE IF NOT EXISTS weather_observations (
    id BIGSERIAL PRIMARY KEY,
    city TEXT NOT NULL,
    temperature_c DOUBLE PRECISION NOT NULL,
    feels_like_c DOUBLE PRECISION,
    humidity_percent INTEGER,
    description TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""


def _database_credentials():
    options = {}
    endpoint = os.environ.get("AWS_ENDPOINT_URL")
    if endpoint:
        options["endpoint_url"] = endpoint

    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    if region:
        options["region_name"] = region

    response = boto3.client("secretsmanager", **options).get_secret_value(
        SecretId=SECRET_ID
    )
    return json.loads(response["SecretString"])


def _connect():
    credentials = _database_credentials()
    connection = psycopg2.connect(
        host=credentials["host"],
        port=int(credentials.get("port", 5432)),
        dbname=credentials.get("database") or credentials["dbname"],
        user=credentials["username"],
        password=credentials["password"],
        connect_timeout=5,
    )
    with connection.cursor() as cursor:
        cursor.execute(TABLE_SQL)
    connection.commit()
    return connection


def _serialize(row):
    result = dict(row)
    result["observed_at"] = result["observed_at"].isoformat()
    return result


@app.get("/health")
def health():
    try:
        with closing(_connect()) as connection:
            with connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1")
        return jsonify({"status": "ok", "database": "connected"})
    except Exception:
        logger.exception("Weather API health check failed")
        return jsonify({"status": "error", "database": "unavailable"}), 503


@app.get("/weather")
def get_weather():
    city = request.args.get("city", "").strip()
    try:
        with closing(_connect()) as connection:
            with connection:
                with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                    if city:
                        cursor.execute(
                            """
                            SELECT id, city, temperature_c, feels_like_c,
                                   humidity_percent, description, observed_at
                            FROM weather_observations
                            WHERE city ILIKE %s
                            ORDER BY observed_at DESC, id DESC
                            LIMIT 1
                            """,
                            (city,),
                        )
                        row = cursor.fetchone()
                        if row is None:
                            return jsonify({"error": f"No weather data for {city}"}), 404
                        return jsonify(_serialize(row))

                    cursor.execute(
                        """
                        SELECT id, city, temperature_c, feels_like_c,
                               humidity_percent, description, observed_at
                        FROM weather_observations
                        ORDER BY observed_at DESC, id DESC
                        LIMIT 20
                        """
                    )
                    rows = [_serialize(row) for row in cursor.fetchall()]
                    return jsonify({"count": len(rows), "results": rows})
    except Exception:
        logger.exception("Weather query failed")
        return jsonify({"error": "Unable to retrieve weather data"}), 500


@app.post("/weather")
def create_weather():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400

    city = payload.get("city")
    temperature = payload.get("temperature_c")
    description = payload.get("description")
    feels_like = payload.get("feels_like_c")
    humidity = payload.get("humidity_percent")

    if not isinstance(city, str) or not city.strip() or len(city) > 120:
        return jsonify({"error": "city must be a non-empty string (max 120 chars)"}), 400
    if (
        isinstance(temperature, bool)
        or not isinstance(temperature, (int, float))
        or not math.isfinite(temperature)
    ):
        return jsonify({"error": "temperature_c must be a finite number"}), 400
    if not isinstance(description, str) or not description.strip() or len(description) > 500:
        return jsonify({"error": "description must be a non-empty string (max 500 chars)"}), 400
    if feels_like is not None and (
        isinstance(feels_like, bool)
        or not isinstance(feels_like, (int, float))
        or not math.isfinite(feels_like)
    ):
        return jsonify({"error": "feels_like_c must be a finite number"}), 400
    if humidity is not None and (
        isinstance(humidity, bool)
        or not isinstance(humidity, int)
        or not 0 <= humidity <= 100
    ):
        return jsonify({"error": "humidity_percent must be an integer from 0 to 100"}), 400

    try:
        with closing(_connect()) as connection:
            with connection:
                with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute(
                        """
                        INSERT INTO weather_observations
                            (city, temperature_c, feels_like_c, humidity_percent, description)
                        VALUES (%s, %s, %s, %s, %s)
                        RETURNING id, city, temperature_c, feels_like_c,
                                  humidity_percent, description, observed_at
                        """,
                        (
                            city.strip(),
                            temperature,
                            feels_like,
                            humidity,
                            description.strip(),
                        ),
                    )
                    record = _serialize(cursor.fetchone())
        return jsonify(record), 201
    except Exception:
        logger.exception("Weather insert failed")
        return jsonify({"error": "Unable to save weather data"}), 500
