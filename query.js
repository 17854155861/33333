// Vercel Serverless Function - 点数查询 API
const https = require('https');
const zlib = require('zlib');

// 辅助函数：发送 HTTP 请求
function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        // 处理 gzip 压缩
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

// 解析 cookie
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

// 点数查询主函数
async function queryPoints(email, password, captcha = '') {
  const baseUrl = 'api.wuyinkeji.com';
  let cookies = [];

  const headersHtml = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };

  const headersAjax = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': `https://${baseUrl}/user/login`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
    'Origin': `https://${baseUrl}`,
    'Sec-Fetch-Mode': 'cors',
  };

  try {
    // Step 1: GET login page
    const loginPage = await request({
      hostname: baseUrl,
      path: '/user/login',
      method: 'GET',
      headers: { ...headersHtml, 'Cookie': cookies.join('; ') },
    });
    cookies = parseCookies(loginPage);

    // Step 2: POST login
    const loginData = new URLSearchParams({
      account_type: 'account',
      account: email,
      passwd: password,
      captcha_code: captcha,
      remember: '1',
      captcha: captcha,
    }).toString();

    const loginResp = await request({
      hostname: baseUrl,
      path: '/user/login',
      method: 'POST',
      headers: { 
        ...headersAjax, 
        'Cookie': cookies.join('; '),
        'Content-Length': Buffer.byteLength(loginData)
      },
    }, loginData);
    
    cookies = [...cookies, ...parseCookies(loginResp)];

    const loginResult = JSON.parse(loginResp.body.toString());
    if (loginResult.code !== 200) {
      return { success: false, message: loginResult.msg || '登录失败，请检查账号密码' };
    }

    // Step 3: Access usercenter
    const ucResp = await request({
      hostname: baseUrl,
      path: '/user/usercenter',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': `https://${baseUrl}/user/usercenter`,
        'Cookie': cookies.join('; '),
      },
    });

    const ucHtml = ucResp.body.toString();

    // Parse points
    const pointMatch = ucHtml.match(/class=["']point-tr["'][^>]*>(.*?)<\/tr>/is);
    if (pointMatch) {
      const tdMatches = pointMatch[1].match(/<td[^>]*>\s*([\d,.]+)\s*<\/td>/g);
      if (tdMatches && tdMatches.length >= 3) {
        const values = tdMatches.map(td => {
          const match = td.match(/<td[^>]*>\s*([\d,.]+)\s*<\/td>/);
          return match ? match[1].replace(/,/g, '') : '0';
        });
        return {
          success: true,
          data: {
            today_usage: values[0],
            used_points: values[1],
            avail_quota: values[2],
          }
        };
      }
    }

    return { success: false, message: '登录成功但无法解析点数信息，网站结构可能已更新' };

  } catch (error) {
    console.error('Query error:', error);
    return { success: false, message: '查询失败：' + error.message };
  }
}

// Vercel Serverless Function Handler
module.exports = async (req, res) => {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Health check
  if (req.method === 'GET') {
    res.status(200).json({ status: 'ok', service: 'API Points Query Service' });
    return;
  }

  // 处理 POST 请求
  if (req.method === 'POST') {
    try {
      const { email, password, captcha } = req.body || {};

      if (!email || !password) {
        res.status(400).json({ success: false, message: '邮箱或密码不能为空' });
        return;
      }

      console.log(`Query account: ${email}`);
      const result = await queryPoints(email.trim(), password.trim(), (captcha || '').trim());
      res.status(200).json(result);

    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
    return;
  }

  // 其他方法返回 404
  res.status(404).end();
};
