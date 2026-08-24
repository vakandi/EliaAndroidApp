/**
 * Themed markdown renderer for chat messages (ChatGPT-style rendering).
 * Special treatments: inline code chip, fenced code block banner,
 * blockquote banner, bordered tables, bold/italic, headings, lists, links.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { useTheme, type Theme } from '@/src/theme';

export function MarkdownView({ content }: { content: string }) {
  const theme = useTheme();
  return <Markdown style={makeMarkdownStyles(theme)}>{content}</Markdown>;
}

const makeMarkdownStyles = (theme: Theme) => ({
  body: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  strong: {
    fontWeight: '700' as const,
    color: theme.colors.textPrimary,
  },
  em: {
    fontStyle: 'italic' as const,
  },
  heading1: {
    fontSize: 21,
    fontWeight: '700' as const,
    color: theme.colors.textPrimary,
    marginTop: 12,
    marginBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    paddingBottom: 4,
  },
  heading2: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: theme.colors.textPrimary,
    marginTop: 10,
    marginBottom: 5,
  },
  heading3: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: theme.colors.textPrimary,
    marginTop: 8,
    marginBottom: 4,
  },
  heading4: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: theme.colors.textSecondary,
    marginTop: 8,
    marginBottom: 4,
  },
  heading5: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: theme.colors.textSecondary,
  },
  heading6: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.colors.textTertiary,
  },
  code_inline: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: theme.colors.accent,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  fence: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.colors.textPrimary,
    backgroundColor: theme.dark ? '#0D1117' : theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    marginBottom: 8,
  },
  blockquote: {
    backgroundColor: theme.colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accent,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
    marginBottom: 8,
    marginLeft: 0,
  },
  bullet_list: {
    marginBottom: 8,
  },
  ordered_list: {
    marginBottom: 8,
  },
  list_item: {
    marginBottom: 2,
  },
  link: {
    color: theme.colors.accent,
    textDecorationLine: 'underline' as const,
  },
  hr: {
    backgroundColor: theme.colors.border,
    height: 1,
    marginVertical: 10,
  },
  table: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    marginTop: 6,
    marginBottom: 10,
  },
  thead: {
    backgroundColor: theme.colors.surface,
  },
  th: {
    padding: 6,
    fontWeight: '700' as const,
    color: theme.colors.textPrimary,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  td: {
    padding: 6,
    color: theme.colors.textSecondary,
    borderRightWidth: 1,
    borderColor: theme.colors.border,
  },
});
