import unittest
from photo_config import validate_settings


class PhotoConfigTests(unittest.TestCase):
    def test_defaults_and_valid_mobile_derivatives(self):
        self.assertEqual(validate_settings({'version': 1})['thumbWidth'], 880)
        self.assertEqual(validate_settings({'version': 1, 'thumbWidth': 640, 'fullWidth': 1600, 'quality': 75, 'workers': 2})['workers'], 2)

    def test_invalid_sizes_and_concurrency_are_rejected(self):
        for patch in [{'thumbWidth': 20}, {'quality': 100}, {'workers': True}, {'workers': 100}, {'fullWidth': 640, 'thumbWidth': 1000}]:
            with self.assertRaises(ValueError):
                validate_settings({'version': 1, **patch})
