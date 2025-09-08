import os
import cv2
import logging

logger = logging.getLogger(__name__)

class FrameExtractor:
    def __init__(self, frames_dir="../frames/"):
    
        self.frames_dir = frames_dir
        os.makedirs(self.frames_dir, exist_ok=True)

    def extract_frames_per_second(self, video_path, frames_per_sec=60):
        
        try:
            video_name = os.path.splitext(os.path.basename(video_path))[0]
            output_dir = os.path.join(self.frames_dir, video_name)
            os.makedirs(output_dir, exist_ok=True)

            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                logger.error(f"Cannot open video: {video_path}")
                return None

            video_fps = cap.get(cv2.CAP_PROP_FPS)
            if video_fps == 0:
                logger.error(f"Video FPS cannot be determined: {video_path}")
                cap.release()
                return None

            interval = max(1, int(video_fps / frames_per_sec))

            count, saved = 0, 0
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                if count % interval == 0:
                    frame_filename = os.path.join(output_dir, f"frame_{saved}.jpg")
                    cv2.imwrite(frame_filename, frame)
                    saved += 1

                count += 1

            cap.release()
            logger.info(f"Extracted {saved} frames from {video_path} at ~{frames_per_sec} FPS")
            return output_dir

        except Exception as e:
            logger.error(f"Failed to extract frames from {video_path}: {e}")
            return None
