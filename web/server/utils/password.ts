import {randomBytes, scrypt as scryptCallback, timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";

const scrypt = promisify(scryptCallback);
const passwordHashPrefix = "scrypt";
const passwordKeyLength = 64;

/**
 * 生成 scrypt 密码哈希。
 */
export async function hashUserPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const key = await scrypt(password, salt, passwordKeyLength) as Buffer;
    return `${passwordHashPrefix}:${salt}:${key.toString("hex")}`;
}
