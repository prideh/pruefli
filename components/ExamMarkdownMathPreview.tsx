'use client';

import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import {
  parseExamPreviewBlocks,
  type ExamPreviewBlock,
  type ExamPreviewInlineToken,
} from '@/lib/exam-detail-preview';

export interface ExamMarkdownMathPreviewProps {
  content: string;
  emptyText?: string;
  testId?: string;
}

function renderInlineTokens(tokens: ExamPreviewInlineToken[], keyPrefix: string): React.ReactNode {
  return tokens.map((token, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (token.type) {
      case 'text':
        return <React.Fragment key={key}>{token.text}</React.Fragment>;
      case 'bold':
        return (
          <Box key={key} component="strong" sx={{ fontWeight: 700, color: '#0f172a' }}>
            {token.children.length > 0
              ? renderInlineTokens(token.children, `${key}-b`)
              : token.text}
          </Box>
        );
      case 'italic':
        return (
          <Box key={key} component="em" sx={{ fontStyle: 'italic' }}>
            {token.children.length > 0
              ? renderInlineTokens(token.children, `${key}-i`)
              : token.text}
          </Box>
        );
      case 'code':
        return (
          <Box
            key={key}
            component="code"
            sx={{
              px: 0.6,
              py: 0.15,
              borderRadius: '4px',
              backgroundColor: '#f1f5f9',
              fontFamily: 'monospace',
              fontSize: '0.86em',
              color: '#0f172a',
            }}
          >
            {token.text}
          </Box>
        );
      case 'math':
        if (token.isFallback || !token.html) {
          return (
            <Box
              key={key}
              component="code"
              data-testid="exam-preview-math-fallback"
              data-math-fallback="true"
              sx={{
                px: 0.6,
                py: 0.15,
                borderRadius: '4px',
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                fontFamily: 'monospace',
                fontSize: '0.86em',
                color: '#334155',
                whiteSpace: 'pre-wrap',
              }}
            >
              {token.raw}
            </Box>
          );
        }
        return (
          <Box
            key={key}
            component="span"
            data-testid="exam-preview-math"
            sx={{
              display: token.displayMode ? 'block' : 'inline',
              my: token.displayMode ? 1 : 0,
              overflowX: token.displayMode ? 'auto' : 'visible',
              '& .katex': {
                fontSize: '1.02em',
              },
            }}
            dangerouslySetInnerHTML={{ __html: token.html }}
          />
        );
      default:
        return null;
    }
  });
}

function renderBlock(block: ExamPreviewBlock, index: number): React.ReactNode {
  const key = `block-${index}`;

  switch (block.type) {
    case 'heading': {
      const headingTag =
        block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : block.level === 3 ? 'h3' : 'h4';
      const fontSize =
        block.level === 1
          ? '1.15rem'
          : block.level === 2
            ? '1.04rem'
            : block.level === 3
              ? '0.96rem'
              : '0.9rem';
      return (
        <Typography
          key={key}
          component={headingTag}
          sx={{
            fontSize,
            fontWeight: 800,
            color: '#0f172a',
            mt: index === 0 ? 0 : 1.5,
            mb: 0.5,
            lineHeight: 1.35,
            letterSpacing: '-0.01em',
          }}
        >
          {renderInlineTokens(block.tokens, key)}
        </Typography>
      );
    }

    case 'paragraph':
      return (
        <Typography
          key={key}
          component="p"
          sx={{
            fontSize: '0.88rem',
            lineHeight: 1.6,
            color: '#1e293b',
            m: 0,
            mb: 0.75,
            '&:last-child': { mb: 0 },
          }}
        >
          {renderInlineTokens(block.tokens, key)}
        </Typography>
      );

    case 'list': {
      if (block.ordered) {
        return (
          <Box
            key={key}
            component="ol"
            sx={{
              m: 0,
              mb: 1,
              pl: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.4,
            }}
          >
            {block.items.map((item, itemIdx) => (
              <Box
                key={`${key}-item-${itemIdx}`}
                component="li"
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 0.75,
                  fontSize: '0.88rem',
                  lineHeight: 1.55,
                  color: '#1e293b',
                }}
              >
                <Box
                  component="span"
                  data-testid="exam-preview-list-marker"
                  sx={{ fontWeight: 700, color: '#0f172a', minWidth: '1.35rem', flexShrink: 0 }}
                >
                  {item.marker}{' '}
                </Box>
                <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                  {renderInlineTokens(item.tokens, `${key}-item-${itemIdx}`)}
                </Box>
              </Box>
            ))}
          </Box>
        );
      }

      return (
        <Box
          key={key}
          component="ul"
          sx={{
            m: 0,
            mb: 1,
            pl: 2.75,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.35,
            color: '#1e293b',
            fontSize: '0.88rem',
            lineHeight: 1.55,
          }}
        >
          {block.items.map((item, itemIdx) => (
            <Box key={`${key}-item-${itemIdx}`} component="li" sx={{ pl: 0.25 }}>
              {renderInlineTokens(item.tokens, `${key}-item-${itemIdx}`)}
            </Box>
          ))}
        </Box>
      );
    }

    case 'math-block':
      if (block.isFallback || !block.html) {
        return (
          <Box
            key={key}
            component="pre"
            data-testid="exam-preview-math-fallback"
            data-math-fallback="true"
            sx={{
              m: 0,
              my: 1,
              p: 1,
              borderRadius: '6px',
              backgroundColor: '#f1f5f9',
              border: '1px solid #cbd5e1',
              fontFamily: 'monospace',
              fontSize: '0.84rem',
              color: '#334155',
              whiteSpace: 'pre-wrap',
              overflowX: 'auto',
            }}
          >
            {block.raw}
          </Box>
        );
      }
      return (
        <Box
          key={key}
          data-testid="exam-preview-math-block"
          sx={{
            my: 1,
            py: 0.5,
            overflowX: 'auto',
            '& .katex-display': {
              m: 0,
            },
          }}
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );

    case 'divider':
      return (
        <Box
          key={key}
          component="hr"
          sx={{
            border: 0,
            borderTop: '1px solid #e2e8f0',
            my: 1.25,
          }}
        />
      );

    default:
      return null;
  }
}

export default function ExamMarkdownMathPreview({
  content,
  emptyText = 'Kein Inhalt hinterlegt.',
  testId = 'exam-markdown-math-preview',
}: ExamMarkdownMathPreviewProps) {
  const trimmed = content?.trim() || '';
  const blocks = useMemo(() => parseExamPreviewBlocks(trimmed), [trimmed]);

  if (!trimmed || blocks.length === 0) {
    return (
      <Typography
        variant="body2"
        data-testid={testId}
        sx={{ color: '#64748b', fontSize: '0.88rem' }}
      >
        {emptyText}
      </Typography>
    );
  }

  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      {blocks.map((block, idx) => renderBlock(block, idx))}
    </Box>
  );
}
