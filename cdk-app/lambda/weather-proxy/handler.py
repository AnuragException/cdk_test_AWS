import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    base_url = os.environ.get("WEATHER_API_URL")
    if not base_url:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "WEATHER_API_URL is not configured"}),
        }

    query = event.get("queryStringParameters") or event
    city = query.get("city") if isinstance(query, dict) else None
    url = f"{base_url.rstrip('/')}/weather"
    if city:
        url = f"{url}?{urlencode({'city': city})}"

    try:
        with urlopen(Request(url, headers={"Accept": "application/json"}), timeout=10) as response:
            body = response.read().decode("utf-8")
            return {
                "statusCode": response.status,
                "headers": {"Content-Type": "application/json"},
                "body": body,
            }
    except HTTPError as error:
        return {
            "statusCode": error.code,
            "headers": {"Content-Type": "application/json"},
            "body": error.read().decode("utf-8"),
        }
    except URLError as error:
        logger.error("Weather API request failed: %s", error.reason)
        return {
            "statusCode": 502,
            "body": json.dumps({"error": "Weather API is unavailable"}),
        }
