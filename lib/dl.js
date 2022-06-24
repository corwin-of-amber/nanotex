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

    let progress = new ProgressBar(':inFn  [:bar] :fcurr', {
        width: 40,
        total: parseInt(headers['content-length'])
    })

    let fmt = progress.total > 1e6 ? (n => `${(n / 1e6).toFixed(2)}M`) :
              progress.total > 1e3 ? (n => `${(n / 1e3).toFixed(2)}k`) : n => `${n}`;

    data.on('data', (chunk) => {
        let curr = progress.curr + chunk.length;
        progress.tick(chunk.length, {inFn, 'fcurr': fmt(curr)})
    })

    return new Promise(resolve =>
        data.pipe(fs.createWriteStream(outFn)).on('close', resolve));
}
