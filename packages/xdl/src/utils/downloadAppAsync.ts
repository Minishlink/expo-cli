import { UserSettings } from '@expo/api';
import axios, { AxiosRequestConfig, Canceler } from 'axios';
import fs from 'fs-extra';
import path from 'path';

import { extractTarAsync } from './tar';

const TIMER_DURATION = 30000;
const TIMEOUT = 3600000;

type ProgressCallback = (progressPercentage: number) => void;
type RetryCallback = (cancel: Canceler) => void;

async function downloadAsync(
  url: string,
  outputPath: string,
  progressFunction?: ProgressCallback,
  retryFunction?: RetryCallback
) {
  let promptShown = false;
  let currentProgress = 0;

  const { cancel, token } = axios.CancelToken.source();

  let warningTimer = setTimeout(() => {
    if (retryFunction) {
      retryFunction(cancel);
    }
    promptShown = true;
  }, TIMER_DURATION);

  const tmpPath = `${outputPath}.download`;
  const config: AxiosRequestConfig = {
    timeout: TIMEOUT,
    responseType: 'stream',
    cancelToken: token,
  };
  const response = await axios(url, config);
  await new Promise<void>(resolve => {
    const totalDownloadSize = response.data.headers['content-length'];
    let downloadProgress = 0;
    response.data
      .on('data', (chunk: Buffer) => {
        downloadProgress += chunk.length;
        const roundedProgress = Math.floor((downloadProgress / totalDownloadSize) * 100);
        if (currentProgress !== roundedProgress) {
          currentProgress = roundedProgress;
          clearTimeout(warningTimer);
          if (!promptShown) {
            warningTimer = setTimeout(() => {
              if (retryFunction) {
                retryFunction(cancel);
              }
              promptShown = true;
            }, TIMER_DURATION);
          }
          if (progressFunction) {
            progressFunction(roundedProgress);
          }
        }
      })
      .on('end', () => {
        clearTimeout(warningTimer);
        if (progressFunction && currentProgress !== 100) {
          progressFunction(100);
        }
        resolve();
      })
      .pipe(fs.createWriteStream(tmpPath));
  });
  await fs.promises.rename(tmpPath, outputPath);
}

export async function downloadAppAsync(
  url: string,
  outputPath: string,
  { extract = false } = {},
  progressFunction?: ProgressCallback,
  retryFunction?: RetryCallback
): Promise<void> {
  if (extract) {
    const directory = UserSettings.getDirectory();
    const tmpPath = path.join(directory, 'tmp-download-file');
    await downloadAsync(url, tmpPath, progressFunction);
    await extractTarAsync(tmpPath, outputPath);
    await fs.remove(tmpPath);
  } else {
    await downloadAsync(url, outputPath, progressFunction, retryFunction);
  }
}
