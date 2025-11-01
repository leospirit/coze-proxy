import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// 环境变量 (Render 后台会设置)
const COZE_API_HOST = 'https://api.coze.cn'; // 你在 coze.cn 就保持这个。如果用 coze.com，请改成 https://api.coze.com
const COZE_BOT_ID   = process.env.COZE_BOT_ID;
const COZE_TOKEN    = process.env.COZE_TOKEN;

// 调试输出，方便在 Render 日志里确认环境有没有读到
console.log('[BOOT] COZE_API_HOST =', COZE_API_HOST);
console.log('[BOOT] COZE_BOT_ID =', COZE_BOT_ID);
console.log(
  '[BOOT] COZE_TOKEN first10 =',
  COZE_TOKEN ? COZE_TOKEN.slice(0, 10) : '(EMPTY)'
);

const app = express();
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// 小程序/前端用的聊天接口
app.post('/api/chat', async (req, res) => {
  const { user_id, message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required (string)' });
  }

  try {
    // 向 Coze 请求对话
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
        stream: false
      })
    });

    const data = await cozeResp.json();

    // 调试：把 Coze 原始返回打一部分到日志，看看里面有没有 messages
    console.log('[COZE RAW]', JSON.stringify(data).slice(0, 400));

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
