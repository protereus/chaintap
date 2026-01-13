import { z } from 'zod';

export const ethereumAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format');

export const chainIdSchema = z.number().int().positive();

export const blockNumberSchema = z.number().int().nonnegative();

export const urlSchema = z.string().url('Invalid URL format');

export function validateEthereumAddress(address: string): boolean {
  return ethereumAddressSchema.safeParse(address).success;
}

export function validateChainId(chainId: number): boolean {
  return chainIdSchema.safeParse(chainId).success;
}

export function validateBlockNumber(blockNumber: number): boolean {
  return blockNumberSchema.safeParse(blockNumber).success;
}
