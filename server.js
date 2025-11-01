import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// === 环境变量，从 Render 的 Environment 里来 ===
const COZE_API_HOST = 'https://api.coze.cn'; // 如果你的 bot 在 coze.com，请改成 https://api.coze.com
const COZE_BOT_ID   = process.env.COZE_BOT_ID;
const COZE_TOKEN    = process.env.COZE_TOKEN;

console.log('[BOOT] COZE_API_HOST =', COZE_API_HOST);
console.log('[BOOT] COZE_BOT_ID =', COZE_BOT_ID);
console.log('[BOOT] COZE_TOKEN first10 =', COZE_TOKEN ? COZE_TOKEN.slice(0, 10) : '(EMPTY)');

const app = express();
app.use(cors());
app.use(express.json());

/**
 * 轮询 Coze，直到有真正的机器人回答
 * 传入的是 conversation_id
 */
async function waitForAnswer(conversationId) {
  const maxTries = 20;   // 最多问20次
  const delayMs  = 500;  // 每次等0.5秒

  for (let i = 0; i < maxTries; i++) {
    const resp = await fetch(`${COZE_API_HOST}/v3/chat/retrieve_messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: conversationId, // 关键字段：conversation_id
      })
    });

    const data = await resp.json();
    console.log('[POLL]', i, JSON.stringify(data).slice(0, 400));

    // 如果 Coze 报错，比如 code=4001，直接返回错误信息
    if (typeof data.code !== 'undefined' && data.code !== 0) {
      return { answer: `（Coze 返回错误 ${data.code}：${data.msg || '未知错误'}）` };
    }

    // 判断状态是否完成
    if (
      data.status === 'completed' ||
      data.status === 'succeeded' ||
      data.status === 'success'   ||
      data.status === 'done'
    ) {
      // 从 messages 里找到机器人说的话
      let answerText = '';

      if (Array.isArray(data.messages)) {
        const botMsg = data.messages.find(
          m =>
            m.role === 'assistant' &&
            typeof m.content === 'string' &&
            m.content.trim() !== ''
        );
        if (botMsg) {
          answerText = botMsg.content;
        }
      }

      if (!answerText) {
        answerText = '（没有拿到assistant回复）';
      }

      return { answer: answerText };
    }

    // 还在生成中 -> 等一会再问
    await new Promise(r => setTimeout(r, delayMs));
  }

  // 超时
  return { answer: '（等待超时，稍后再试）' };
}

// === 健康检查，浏览器/微信后台可以直接 GET 看服务活没活 ===
app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// === 这个就是给你小程序用的聊天接口 ===
app.post('/api/chat', async (req, res) => {
  const { user_id, message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required (string)' });
  }

  try {
    // 第一步：向 Coze 发起对话请求
    const createResp = await fetch(`${COZE_API_HOST}/v3/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: COZE_BOT_ID,
        user_id: user_id || 'wx_user_001', // 之后可以换成真实 openid 之类
        additional_messages: [
          {
            role: 'user',
            content: message,
            content_type: 'text',
          }
        ],
        stream: false // 我们用整块式，方便小程序一次拿到
      })
    });

    const createData = await createResp.json();
    console.log('[CREATE]', JSON.stringify(createData).slice(0, 400));

    // 从返回里拿会话ID（优先 conversation_id）
    const conversationId =
      createData?.data?.conversation_id ||
      createData?.conversation_id ||
      createData?.data?.id ||
      createData?.id ||
      createData?.chat_id;

    if (!conversationId) {
      console.log('[ERROR] 没拿到 conversationId');
      return res.json({ answer: '（无法获取任务ID）' });
    }

    // 第二步：轮询，直到 Coze 真正给出 assistant 回复
    const finalResult = await waitForAnswer(conversationId);

    // 返回给前端 / 小程序
    return res.json(finalResult);
  } catch (err) {
    console.error('Coze proxy error:', err);
    return res.status(500).json({ error: 'Coze API failed' });
  }
});

// === 启动服务（Render 会注入 PORT） ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
