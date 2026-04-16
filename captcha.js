// Vercel Serverless Function - 获取验证码图片
const https = require('https');
const zlib = require('zlib');

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        if (res.headers['content-encoding'] === 'gzip') {
          zlib.gunzip(buffer, (err, decoded) => {
            if (err) reject(err);
            else resolve({ statusCode: res.statusCode, headers: res.headers, body: decoded });
          });
        } else {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: buffer });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function parseCookies(response) {
  const cookies = [];
  const setCookie = response.headers['set-cookie'];
  if (setCookie) {
    setCookie.forEach(cookie => {
      cookies.push(cookie.split(';')[0]);
    });
  }
  return cookies;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(404).end();
    return;
  }

  try {
    const baseUrl = 'api.wuyinkeji.com';

    // Step 1: 访问登录页获取初始 Cookie（包含 session）
    const loginPage = await request({
      hostname: baseUrl,
      path: '/user/login',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });

    const cookies = parseCookies(loginPage);
    const sessionCookie = cookies.join('; ');

    // Step 2: 获取验证码图片（常见路径，逐一尝试）
    const captchaPaths = [
      '/user/captcha',
      '/captcha',
      '/captcha.html',
      '/user/login/captcha',
      '/verify/captcha',
      '/api/captcha',
    ];

    let imgBuffer = null;
    let imgContentType = 'image/png';

    for (const path of captchaPaths) {
      try {
        const capResp = await request({
          hostname: baseUrl,
          path: path,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
            'Referer': `https://${baseUrl}/user/login`,
            'Cookie': sessionCookie,
          },
        });

        const ct = capResp.headers['content-type'] || '';
        if (ct.startsWith('image/')) {
          imgBuffer = capResp.body;
          imgContentType = ct;
          break;
        }
      } catch (e) {
        // 继续尝试下一个路径
      }
    }

    if (!imgBuffer) {
      // 如果都找不到，返回空图信号，告知前端找不到
      return res.status(200).json({
        success: false,
        message: '未找到验证码图片接口，请直接输入验证码',
        session: sessionCookie,
      });
    }

    // 将图片转 base64 返回给前端
    const base64 = imgBuffer.toString('base64');
    return res.status(200).json({
      success: true,
      image: `data:${imgContentType};base64,${base64}`,
      session: sessionCookie,
    });

  } catch (error) {
    console.error('Captcha error:', error);
    res.status(500).json({ success: false, message: '获取验证码失败: ' + error.message });
  }
};
