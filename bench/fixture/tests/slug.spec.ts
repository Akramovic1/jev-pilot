import { expect, test } from 'bun:test'
import { slugify } from '../src/slug.ts'

test('lowercase words joined by dashes', () => expect(slugify('Blue Coffee Mug')).toBe('blue-coffee-mug'))
test('trims and collapses spaces, underscores and dashes', () => expect(slugify('  Big__Tea -- Pot ')).toBe('big-tea-pot'))
test('drops accents', () => expect(slugify('Crème Brûlée Set')).toBe('creme-brulee-set'))
test('drops other punctuation', () => expect(slugify("Joe's #1 Mug!")).toBe('joes-1-mug'))
test('keeps digits', () => expect(slugify('Mug 2000')).toBe('mug-2000'))
test('never longer than 30, cut at a word', () => expect(slugify('The Extra Large Hand Painted Ceramic Coffee Mug')).toBe('the-extra-large-hand-painted'))
test('empty in, empty out', () => expect(slugify('  !!  ')).toBe(''))
