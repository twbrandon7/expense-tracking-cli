import fs from 'fs';
import yaml from 'js-yaml';
import { ClassificationConfig, ClassificationRule } from '../types';

export function extractTaxonomy(config: ClassificationConfig): Record<string, string[]> {
  const taxonomy: Record<string, Set<string>> = {
    '計畫': new Set<string>(),
    '非計畫': new Set<string>()
  };

  const allRules = [...config.user_rules, ...config.llm_rules];
  for (const rule of allRules) {
    if (!rule.type || !rule.sub_type) continue;
    if (!taxonomy[rule.type]) {
      taxonomy[rule.type] = new Set<string>();
    }
    taxonomy[rule.type].add(rule.sub_type);
  }

  const result: Record<string, string[]> = {};
  for (const [type, subTypes] of Object.entries(taxonomy)) {
    result[type] = Array.from(subTypes);
  }
  return result;
}

export function loadClassificationConfig(filePath: string): ClassificationConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Classification config file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw) as Partial<ClassificationConfig> | null;

  if (!parsed) {
    throw new Error(`Failed to parse classification config file: ${filePath}`);
  }

  return {
    base_currency: parsed.base_currency || 'TWD',
    user_rules: Array.isArray(parsed.user_rules) ? parsed.user_rules : [],
    llm_rules: Array.isArray(parsed.llm_rules) ? parsed.llm_rules : []
  };
}

export function saveClassificationConfig(filePath: string, config: ClassificationConfig): void {
  const cleanConfig: ClassificationConfig = {
    base_currency: config.base_currency || 'TWD',
    user_rules: config.user_rules,
    llm_rules: config.llm_rules
  };

  const yamlContent = yaml.dump(cleanConfig, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"'
  });
  fs.writeFileSync(filePath, yamlContent, 'utf8');
}

export function matchRule(description: string, rules: ClassificationRule[]): ClassificationRule | null {
  for (const rule of rules) {
    if (!rule.pattern) continue;

    if (rule.is_regex) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(description)) {
          return rule;
        }
      } catch {
        // Fallback to substring match if regex invalid
        if (description.toLowerCase().includes(rule.pattern.toLowerCase())) {
          return rule;
        }
      }
    } else {
      if (description.toLowerCase().includes(rule.pattern.toLowerCase())) {
        return rule;
      }
    }
  }

  return null;
}

export function recordLlmRule(
  config: ClassificationConfig,
  newRule: ClassificationRule,
  configPath?: string
): void {
  // Check if rule pattern already exists in llm_rules or user_rules
  const existsInUser = config.user_rules.some((r) => r.pattern.toLowerCase() === newRule.pattern.toLowerCase());
  const existsInLlm = config.llm_rules.some((r) => r.pattern.toLowerCase() === newRule.pattern.toLowerCase());

  if (!existsInUser && !existsInLlm) {
    config.llm_rules.push(newRule);
  }

  if (configPath) {
    saveClassificationConfig(configPath, config);
  }
}
