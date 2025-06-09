/**
 * Google FormsのフィールドIDマッピング設定
 * 
 * Google Forms APIから取得したitemIdと実際のentry IDが異なる場合に使用
 * 
 * 設定方法:
 * 1. ブラウザでGoogle Formsを開く
 * 2. 開発者ツールのConsoleで以下を実行:
 *    Array.from(document.querySelectorAll('[name^="entry."]')).map(e => ({ name: e.name, label: e.closest('.freebirdFormviewerComponentsQuestionBaseRoot')?.querySelector('.freebirdFormviewerComponentsQuestionBaseTitle')?.textContent }))
 * 3. 取得したentry IDをここに設定
 */

export interface FormFieldMapping {
  formId: string;
  fieldMappings: {
    [fieldName: string]: string; // fieldName -> entry.XXXXXXXXXX
  };
}

// フォームごとのカスタムマッピング
export const customFormMappings: FormFieldMapping[] = [
  {
    formId: '1dhF9G4FkY-nPkWqac9BIR4lgqXu71ZWgddJSFyH5tnc',
    fieldMappings: {
      // 実際のentry IDに置き換えてください
      // 例:
      // name: 'entry.1234567890',
      // studentId: 'entry.0987654321',
      // discordUsername: 'entry.1111111111'
    }
  }
];

/**
 * フォームIDに基づいてカスタムマッピングを取得
 */
export function getCustomMapping(formId: string): FormFieldMapping | undefined {
  return customFormMappings.find(mapping => mapping.formId === formId);
}