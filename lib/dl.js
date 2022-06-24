import fs from 'fs';
import axios from 'axios';
import ProgressBar from 'progress';


export default
async function downloadFile(url, outFn) {
    let inFn = url.match(/[^/]*$/)[0];
    const { data, headers } = await axios({
        url,
        method: "GET",
        responseType: "stream",
    });

    let progress = new ProgressBar(':inFn  [:bar] :currMM', {
        width: 40,
        total: parseInt(headers['content-length'])
    })

    data.on('data', (chunk) => {
        let curr = progress.curr + chunk.length;
        progress.tick(chunk.length, {inFn, 'currM': (curr / 1e6).toFixed(2)})
    })

    data.pipe(fs.createWriteStream(outFn))
}
