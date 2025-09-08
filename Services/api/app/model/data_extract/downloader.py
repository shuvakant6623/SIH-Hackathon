import os 
import requests
import logging

logger = logging.getLogger(__name__)

class MediaDownloader:
    def __init__(self, download_dir = "../data/"):
        self.download_dir = download_dir
        os.makedirs(self.download_dir, exist_ok = True)

    def download(self, url, filename=None):
        try:
            if not filename:
                filenmae = url.split("/")[-1].split("?")[0]

            filepath = os.path.join(self.download_dir, filename)
            response = requests.get(url, stream=True, timeout=15)
            response.raise_for_status()

            with open(filepath, "wb") as f:
                for chunk in response.iter_content(1024):
                    f.write(chunk)

            logger.info(f"Downloaded: {filepath}")
            return filepath
        
        except Exception as e:
            logger.error(f"Failed to download {url}: {e}")
            return None