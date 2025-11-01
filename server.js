import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// 环境变量（Render 后台会设置）
const COZE_API_HOST = 'https://api.coze.cn'; // 如果你用的是国际版 coze.com，就换成 https://api.coze.com
const COZE_BOT_ID = process.env.COZE_BOT_ID;
const COZE_TOKEN  = process.env.COZE_TOKEN;

const app = express();
app.use(cors());
app.use(express.json());

// 健康检查用，Render/你自己可以打开根路径看看服务有没有活着
app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// 我们真正给小程序用的接口：POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { user_id, message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required (string)' });
  }

  try {
    // 调用 Coze 的聊天接口
    const cozeResp = await fetch(`${COZE_API_HOST}/v3/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: COZE_BOT_ID,
        user_id: user_id || 'wx_user_001',
        additional_messages: [
          {
            role: 'user',
            content: message,
            content_type: 'text'
          }
        ],
        stream: false // 我们用整块回答，方便小程序拿到
      })
    });

    const data = await cozeResp.json();

    // 从 Coze 返回中提取助手机器人的文本回答
    let answer = '';
    if (Array.isArray(data.messages)) {
      const botMsg = data.messages.find(m => m.role === 'assistant');
      if (botMsg && botMsg.content) {
        answer = botMsg.content;
      }
    }
    if (!answer) {
      answer = '（没有拿到有效回复）';
    }

    return res.json({ answer });
  } catch (err) {
    console.error('Coze proxy error:', err);
    return res.status(500).json({ error: 'Coze API failed' });
  }
});

// Render 会在环境变量里注入 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
