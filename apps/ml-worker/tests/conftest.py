import os
import pytest
from unittest.mock import patch, MagicMock

@pytest.fixture(autouse=True)
def mock_env_vars():
    """Mock environment variables for testing."""
    os.environ['AWS_ACCESS_KEY_ID'] = 'test'
    os.environ['AWS_SECRET_ACCESS_KEY'] = 'test'
    os.environ['AWS_REGION'] = 'us-east-1'
    os.environ['SQS_QUEUE_URL'] = 'http://localhost:4566/000000000000/stride-video-processing'
    os.environ['S3_BUCKET_NAME'] = 'stride-videos'
    os.environ['GEMINI_API_KEY'] = 'test-gemini-key'
    yield

@pytest.fixture
def mock_s3():
    """Mock S3 client."""
    with patch('boto3.client') as mock_client:
        s3 = MagicMock()
        mock_client.return_value = s3
        yield s3

@pytest.fixture
def mock_sqs():
    """Mock SQS client."""
    with patch('boto3.client') as mock_client:
        sqs = MagicMock()
        mock_client.return_value = sqs
        yield sqs

@pytest.fixture
def mock_gemini():
    """Mock Gemini client."""
    with patch('src.llm.genai.Client') as mock_client:
        client_instance = MagicMock()
        mock_client.return_value = client_instance
        
        # Mock the models.generate_content response
        mock_response = MagicMock()
        mock_response.text = '''{
            "overall_score": 85,
            "score_label": "Excellent job...",
            "movenet_version": "singlepose-thunder-v4",
            "primary_issues": [
                {
                    "rank": 1,
                    "type": "low_knee_drive",
                    "severity": "medium",
                    "measured_value": "82.5°",
                    "optimal_range": "90-95°",
                    "plain_english": "Your knee drive is slightly low...",
                    "drills": [
                        {
                            "drill_key": "a_skips",
                            "name": "A-Skips",
                            "volume": "3 sets of 20m",
                            "cue": "Punch foot down"
                        }
                    ],
                    "timeline": "2-3 weeks"
                }
            ]
        }'''
        client_instance.models.generate_content.return_value = mock_response
        yield client_instance
