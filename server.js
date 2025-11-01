import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// === 环境变量（Render 上配置的） ===
const COZE_API_HOST = 'https://api.coze.cn'; // 如果你之后用 coze.com 机器人，改成 https://api.coze.com
const COZE_BOT_ID   = process.env.COZE_BOT_ID;
const COZE_TOKEN    = process.env.COZE_TOKEN;

console.log('[BOOT] COZE_API_HOST =', COZE_API_HOST);
console.log('[BOOT] COZE_BOT_ID =', COZE_BOT_ID);
console.log('[BOOT] COZE_TOKEN first10 =', COZE_TOKEN ? COZE_TOKEN.slice(0, 10) : '(EMPTY)');

const app = express();
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

/**
 * 小程序会 POST /api/chat
 * body = { "message": "你好，介绍一下你自己" }
 * 我们转发给 Coze 的同步对话接口，拿到最终回答后直接返回。
 */
app.post('/api/chat', async (req, res) => {
  const { user_id, message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required (string)' });
  }

  try {
    // 这里我们调用“同步问答（completion-style）”接口。
    // 不再自己轮询，不再用 retrieve_messages。
    //
    // 注意：以下路径 /v3/chat/completions 是基于 Coze 的
    // 同步生成式接口命名习惯。如果你部署后依然报
    // “does not exist”，把这个路径最后一段改成
    // /v3/chat 或 /v3/chat/message 之类的并观察日志。
    //
    // 我们会把请求打印到 Render 日志里，方便定位。
    console.log('[REQ] send to Coze /v3/chat/completions:', {
      bot_id: COZE_BOT_ID,
      user_id: user_id || 'wx_user_001',
      content_preview: message.slice(0, 30)
    });

    const cozeResp = await fetch(`${COZE_API_HOST}/v3/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: COZE_BOT_ID,
        user_id: user_id || 'wx_user_001',
        // Coze 标准问答输入往往是 messages 数组，role=user/content=你的提问
        messages: [
          {
            role: 'user',
            content: message,
          }
        ],
        // 我们只要最终结果，不要流式
        stream: false
      })
    });

    const data = await cozeResp.json();
    console.log('[COZE RAW COMPLETION]', JSON.stringify(data).slice(0, 400));

    // 我们尝试多种常见位置去拿回答文本
    let answerText = '';

    // 1. OpenAI-style: data.choices[0].message.content
    if (
      data.choices &&
      Array.isArray(data.choices) &&
      data.choices[0] &&
      data.choices[0].message &&
      typeof data.choices[0].message.content === 'string'
    ) {
      answerText = data.choices[0].message.content;
    }

    // 2. 部分 Coze 返回 data.messages 数组（兼容兜底）
    if (!answerText && Array.isArray(data.messages)) {
      const botMsg = data.messages.find(m => m.role === 'assistant' && m.content);
      if (botMsg) {
        answerText = botMsg.content;
      }
    }

    if (!answerText) {
      // 如果还没拿到，就把错误/状态透传出来便于调试
      answerText = `（Coze 返回了但是没有标准回答，code=${data.code ?? 'NA'} status=${data.status ?? 'NA'}）`;
    }

    return res.json({ answer: answerText });
  } catch (err) {
    console.error('Coze proxy error:', err);
    return res.status(500).json({ error: 'Coze API failed' });
  }
});

// Render 注入 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
