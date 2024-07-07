const { readFileSync } = require("fs");
const { Twisters } = require("twisters");
const sol = require("@solana/web3.js");
const bs58 = require("bs58");
const prompts = require('prompts');
const nacl = require("tweetnacl");

const rpc = 'https://devnet.sonic.game/';
const connection = new sol.Connection(rpc, 'confirmed');
const keypairs = [];
const twisters = new Twisters();

let defaultHeaders = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.7',
    'content-type': 'application/json',
    'priority': 'u=1, i',
    'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Brave";v="126"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'sec-gpc': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

function getKeypairFromPrivateKey(privateKey) {
    const decoded = bs58.decode(privateKey);
    return sol.Keypair.fromSecretKey(decoded);
}

const sendTransaction = async (transaction, keypair) => {
    try {
        transaction.partialSign(keypair); 
        const rawTransaction = transaction.serialize();
        const signature = await connection.sendRawTransaction(rawTransaction);
        await connection.confirmTransaction(signature);
        return signature;
    } catch (error) {
        console.error("Transaction failed:", error);
        throw error;
    }
};

const delay = (seconds) => {
    return new Promise((resolve) => {
        setTimeout(resolve, seconds * 1000);
    });
};

const getLoginToken = (keyPair) => new Promise(async (resolve) => {
    try {
        const message = await fetch(`https://odyssey-api.sonic.game/auth/sonic/challenge?wallet=${keyPair.publicKey}`, {
            headers: defaultHeaders
        }).then(res => res.json());

        const sign = nacl.sign.detached(Buffer.from(message.data), keyPair.secretKey);
        const signature = Buffer.from(sign).toString('base64');
        const publicKey = keyPair.publicKey.toBase58();
        const addressEncoded = Buffer.from(keyPair.publicKey.toBytes()).toString("base64");
        const authorize = await fetch('https://odyssey-api.sonic.game/auth/sonic/authorize', {
            method: 'POST',
            headers: defaultHeaders,
            body: JSON.stringify({
                'address': publicKey,
                'address_encoded': addressEncoded,
                'signature': signature
            })
        }).then(res => res.json());

        const token = authorize.data.token;
        resolve(token);
    } catch (e) {
        console.error("Failed to get token:", e);
        resolve('FAILED_TO_GET_TOKEN');
    }
});

const openBox = (keyPair, auth) => new Promise(async (resolve) => {
    try {
        const data = await fetch(`https://odyssey-api.sonic.game/user/rewards/mystery-box/build-tx`, {
            headers: {
                ...defaultHeaders,
                'authorization': auth
            }
        }).then(res => res.json());

        if (data.data) {
            const transactionBuffer = Buffer.from(data.data.hash, "base64");
            const transaction = sol.Transaction.from(transactionBuffer);
            transaction.partialSign(keyPair);  
            const signature = await sendTransaction(transaction, keyPair);
            const open = await fetch('https://odyssey-api.sonic.game/user/rewards/mystery-box/open', {
                method: 'POST',
                headers: {
                    ...defaultHeaders,
                    'authorization': auth
                },
                body: JSON.stringify({ 'hash': signature })
            }).then(res => res.json());

            resolve(open.data);
        }
    } catch (e) {
        console.error("Failed to open box:", e);
        resolve('FAILED_TO_OPEN_BOX');
    }
});

const getUserInfo = (auth) => new Promise(async (resolve) => {
    try {
        const data = await fetch('https://odyssey-api.sonic.game/user/rewards/info', {
            headers: {
                ...defaultHeaders,
                'authorization': auth,
            }
        }).then(res => res.json());

        if (data.data) {
            resolve(data.data);
        }
    } catch (e) {
        console.error("Failed to get user info:", e);
        resolve('FAILED_TO_GET_USER_INFO');
    }
});

const tgMessage = async (message) => {
    const token = 'INSERT_YOUR_TELEGRAM_BOT_TOKEN_HERE';
    const chatid = 'INSERT_YOUR_TELEGRAM_BOT_CHATID_HERE';
    const boturl = `https://api.telegram.org/bot${token}/sendMessage`;

    await fetch(boturl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: chatid,
            text: message,
            disable_web_page_preview: true
        }),
    });
};

function extractAddressParts(address) {
    const firstThree = address.slice(0, 4);
    const lastFour = address.slice(-4);
    return `${firstThree}...${lastFour}`;
}

(async () => {
    // GET PRIVATE KEY
    const listAccounts = readFileSync("./old.txt", "utf-8")
        .split("\n")
        .map((a) => a.trim());
    for (const privateKey of listAccounts) {
        keypairs.push(getKeypairFromPrivateKey(privateKey));
    }
    if (keypairs.length === 0) {
        throw new Error('Please fill at least 1 private key in old.txt');
    }

    // ASK TO OPEN BOX
    const q = await prompts([
        {
            type: 'confirm',
            name: 'openBox',
            message: 'Auto Open Mystery Box?',
        },
        {
            type: 'confirm',
            name: 'useBot',
            message: 'Use Telegram Bot as Notification?',
        },
        {
            type: 'number',
            name: 'index',
            message: `You have ${keypairs.length} account, which one do you want to start with? (default is 1)`,
            initial: 1
        }
    ]);

    // DOING TASK FOR EACH PRIVATE KEY
    for (let index = (q.index - 1); index < keypairs.length; index++) {
        const publicKey = keypairs[index].publicKey.toBase58();

        twisters.put(`${publicKey}`, {
            text: ` === ACCOUNT ${(index + 1)} ===\nAddress      : ${publicKey}\nPoints       : -\nMystery Box  : -\nStatus       : Getting user token...`
        });

        let token = await getLoginToken(keypairs[index]);
        let info = await getUserInfo(token);

        twisters.put(`${publicKey}`, {
            text: ` === ACCOUNT ${(index + 1)} ===\nAddress      : ${publicKey}\nPoints       : ${info.ring}\nMystery Box  : ${info.ring_monitor}\nStatus       : -`
        });

        if (q.openBox) {
            twisters.put(`${publicKey}`, {
                active: false,
                text: ` === ACCOUNT ${(index + 1)} ===\nAddress      : ${publicKey}\nPoints       : ${info.ring}\nMystery Box  : ${info.ring_monitor}\nStatus       : Preparing to open ${info.ring_monitor} mystery boxes...`
            });

            for (let i = 0; i < info.ring_monitor; i++) {
                const openedBox = await openBox(keypairs[index], token);
                info = await getUserInfo(token);
                twisters.put(`${publicKey}`, {
                    active: false,
                    text: ` === ACCOUNT ${(index + 1)} ===\nAddress      : ${publicKey}\nPoints       : ${info.ring}\nMystery Box  : ${info.ring_monitor}\nStatus       : [${(i + 1)}/${info.ring_monitor}] You got ${openedBox.amount} points!`
                });
                await delay(5); 
            }

            info = await getUserInfo(token);
            let msg = `Earned ${(info.ring - info.initial_ring)} Points\nYou have ${info.ring} Points and ${info.ring_monitor} Mystery Box now.`;

            if (q.useBot) {
                await tgMessage(`${extractAddressParts(publicKey)} | ${msg}`);
            }

            // YOUR POINTS AND MYSTERY BOX COUNT
            twisters.put(`${publicKey}`, {
                active: false,
                text: ` === ACCOUNT ${(index + 1)} ===\nAddress      : ${publicKey}\nPoints       : ${info.ring}\nMystery Box  : ${info.ring_monitor}\nStatus       : ${msg}`
            });
        }
    }
})();
