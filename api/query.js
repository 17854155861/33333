// Vercel Serverless Function - 点数查询 API
const https = require('https');
const zlib = require('zlib');

module.exports = async (req, res) => {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 只接受 POST 请求
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: '邮箱或密码不能为空'
      });
      return;
    }

    // 调用查询函数
    const result = await queryPoints(email, password);
    res.status(200).json(result);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误: ' + error.message
    });
  }
};

// 查询点数信息
function queryPoints(email, password) {
  return new Promise((resolve, reject) => {
    const baseUrl = 'api.wuyinkeji.com';
    const cookies = [];

    // 第一步：获取登录页面
    const getLoginPage = () => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: baseUrl,
          path: '/user/login',
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Accept-Encoding': 'gzip'
          }
        };

        const req = https.request(options, (res) => {
          // 保存 cookies
          const setCookie = res.headers['set-cookie'];
          if (setCookie) {
            setCookie.forEach(cookie => {
              cookies.push(cookie.split(';')[0]);
            });
          }

          let data = [];
          res.on('data', chunk => data.push(chunk));
          res.on('end', () => {
            if (res.headers['content-encoding'] === 'gzip') {
              zlib.gunzip(Buffer.concat(data), (err, decoded) => {
                resolve();
              });
            } else {
              resolve();
            }
          });
        });

        req.on('error', reject);
        req.end();
      });
    };

    // 第二步：登录
    const doLogin = () => {
      return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
          'account_type': 'account',
          'account': email,
          'passwd': password,
          'captcha_code': '',
          'remember': '1',
          'captcha': ''
        }).toString();

        const options = {
          hostname: baseUrl,
          path: '/user/login',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://${baseUrl}/user/login`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
            'Origin': `https://${baseUrl}`,
            'Accept-Encoding': 'gzip',
            'Cookie': cookies.join('; ')
          }
        };

        const req = https.request(options, (res) => {
          // 保存 cookies
          const setCookie = res.headers['set-cookie'];
          if (setCookie) {
            setCookie.forEach(cookie => {
              cookies.push(cookie.split(';')[0]);
            });
          }

          let data = [];
          res.on('data', chunk => data.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(data);
            const processData = (buf) => {
              try {
                const result = JSON.parse(buf.toString());
                resolve(result);
              } catch (e) {
                resolve({ code: 500, msg: '解析失败' });
              }
            };

            if (res.headers['content-encoding'] === 'gzip') {
              zlib.gunzip(buffer, (err, decoded) => {
                if (err) reject(err);
                else processData(decoded);
              });
            } else {
              processData(buffer);
            }
          });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    };

    // 第三步：获取用户中心页面
    const getUserCenter = () => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: baseUrl,
          path: '/user/usercenter',
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': `https://${baseUrl}/user/usercenter`,
            'Accept-Encoding': 'gzip',
            'Cookie': cookies.join('; ')
          }
        };

        const req = https.request(options, (res) => {
          let data = [];
          res.on('data', chunk => data.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(data);
            const processData = (buf) => {
              resolve(buf.toString());
            };

            if (res.headers['content-encoding'] === 'gzip') {
              zlib.gunzip(buffer, (err, decoded) => {
                if (err) reject(err);
                else processData(decoded);
              });
            } else {
              processData(buffer);
            }
          });
        });

        req.on('error', reject);
        req.end();
      });
    };

    // 执行流程
    (async () => {
      try {
        await getLoginPage();
        const loginResult = await doLogin();

        if (loginResult.code !== 200) {
          resolve({
            success: false,
            message: loginResult.msg || '登录失败，请检查账号密码'
          });
          return;
        }

        const html = await getUserCenter();

        // 解析点数信息
        const match = html.match(/class=["']point-tr["'][^>]*>(.*?)<\/tr>/is);

        if (match) {
          const tds = match[1].match(/<td[^>]*>\s*([\d,.]+)\s*<\/td>/g);
          if (tds && tds.length >= 3) {
            const values = tds.map(td => {
              const val = td.replace(/<[^>]*>/g, '').trim().replace(/,/g, '');
              return val;
            });

            resolve({
              success: true,
              data: {
                today_usage: values[0],
                used_points: values[1],
                avail_quota: values[2]
              }
            });
            return;
          }
        }

        resolve({
          success: false,
          message: '登录成功但无法解析点数信息'
        });

      } catch (error) {
        reject(error);
      }
    })();
  });
}

