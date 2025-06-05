import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, User } from 'discord.js';
import { validateAdvancedPermissions, logCommandUsage } from '../../utils/permissions';
import { DatabaseService } from '../../services/database';
import { GoogleSheetsService } from '../../services/google';
import { RegistrationService } from '../../services/registration';
import { MemberValidator, MemberConverter, MemberFormatter } from '../../utils/memberUtils';
import { logger } from '../../utils/logger';
import { Member, MemberUpdate } from '../../types';

export default {
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription('部員管理コマンド')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('全部員一覧を表示します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('search')
        .setDescription('部員を検索します')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('検索クエリ（名前、Discord名、ユーザー名、学籍番号）')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('register')
        .setDescription('新規部員を手動で登録します')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('登録するDiscordユーザー')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('本名')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('student_id')
            .setDescription('学籍番号')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('gender')
            .setDescription('性別')
            .setRequired(true)
            .addChoices(
              { name: '男性', value: '男性' },
              { name: '女性', value: '女性' },
              { name: 'その他', value: 'その他' }
            )
        )
        .addStringOption(option =>
          option
            .setName('team')
            .setDescription('班')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('grade')
            .setDescription('学年')
            .setRequired(true)
            .addChoices(
              { name: '1年生', value: '1' },
              { name: '2年生', value: '2' },
              { name: '3年生', value: '3' },
              { name: '4年生', value: '4' },
              { name: 'OB', value: 'OB' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('update')
        .setDescription('部員情報を更新します')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('更新するDiscordユーザー')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('field')
            .setDescription('更新する項目')
            .setRequired(true)
            .addChoices(
              { name: '本名', value: 'name' },
              { name: 'Discord表示名', value: 'discordDisplayName' },
              { name: '学籍番号', value: 'studentId' },
              { name: '性別', value: 'gender' },
              { name: '班', value: 'team' },
              { name: '学年', value: 'grade' }
            )
        )
        .addStringOption(option =>
          option
            .setName('value')
            .setDescription('新しい値')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('部員を削除します')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('削除するDiscordユーザー')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('grade-up')
        .setDescription('全部員の学年を一括で繰り上げます（年度更新用）')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    
    const isAdminCommand = ['register', 'update', 'delete', 'grade-up', 'search'].includes(subcommand);
    const permissionLevel = {
      level: isAdminCommand ? 'admin' : 'member',
      // 検索機能は制限チャンネルでも使用可能に
      restrictedChannels: subcommand === 'search' ? [] : undefined
    } as const;
    
    if (!await validateAdvancedPermissions(interaction, permissionLevel)) return;

    const db = new DatabaseService();
    await db.initialize();
    
    const sheetsService = new GoogleSheetsService();

    try {
      switch (subcommand) {
        case 'list':
          await handleList(interaction, db);
          break;
        case 'search':
          await handleSearch(interaction, db);
          break;
        case 'register':
          await handleRegister(interaction, db, sheetsService);
          break;
        case 'update':
          await handleUpdate(interaction, db, sheetsService);
          break;
        case 'delete':
          await handleDelete(interaction, db);
          break;
        case 'grade-up':
          await handleGradeUp(interaction, db, sheetsService);
          break;
      }
    } catch (error) {
      logger.error(`部員管理コマンドエラー: ${subcommand}`, { error: error.message });
      
      const errorMessage = 'コマンドの実行中にエラーが発生しました。';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } finally {
      await db.close();
    }
  },
};

async function handleList(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  await interaction.deferReply();
  
  const members = await db.getAllMembers();
  
  if (members.length === 0) {
    await interaction.editReply('登録されている部員がいません。');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('👥 部員一覧')
    .setDescription(`登録部員数: ${members.length}名`)
    .setTimestamp();

  const membersByGrade = members.reduce((acc, dbMember) => {
    const member = MemberConverter.dbRowToMember(dbMember);
    if (member) {
      const grade = member.grade.toString() || '不明';
      if (!acc[grade]) acc[grade] = [];
      acc[grade].push(member);
    }
    return acc;
  }, {} as Record<string, Member[]>);

  const gradeOrder = ['1', '2', '3', '4', '5', '6', 'OB', '不明'];
  
  for (const grade of gradeOrder) {
    if (membersByGrade[grade]) {
      const memberList = membersByGrade[grade]
        .map(member => `${member.name} (${member.team})`)
        .join('\n');
      
      embed.addFields({
        name: `${grade}年生 (${membersByGrade[grade].length}名)`,
        value: memberList || 'なし',
        inline: true,
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
  logCommandUsage(interaction, '部員一覧表示');
}

async function handleSearch(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  const query = interaction.options.getString('query', true);
  
  await interaction.deferReply({ ephemeral: true });
  
  const members = await db.searchMembers(query);
  
  if (members.length === 0) {
    await interaction.editReply(`「${query}」に該当する部員が見つかりませんでした。`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🔍 部員検索結果')
    .setDescription(`「${query}」の検索結果: ${members.length}件`)
    .setTimestamp();

  for (const dbMember of members.slice(0, 5)) {
    const member = MemberConverter.dbRowToMember(dbMember);
    if (member) {
      const memberEmbed = MemberFormatter.toEmbed(member, dbMember.discord_id);
      embed.addFields({
        name: memberEmbed.title,
        value: memberEmbed.fields.map(f => `**${f.name}**: ${f.value}`).join('\n'),
        inline: false,
      });
    }
  }

  if (members.length > 5) {
    embed.setFooter({ text: `他に ${members.length - 5} 件の結果があります` });
  }

  await interaction.editReply({ embeds: [embed] });
  logCommandUsage(interaction, '部員検索', query);
}

async function handleRegister(
  interaction: ChatInputCommandInteraction,
  db: DatabaseService,
  sheetsService: GoogleSheetsService
) {
  const user = interaction.options.getUser('user', true);
  const name = interaction.options.getString('name', true);
  const studentId = interaction.options.getString('student_id', true);
  const gender = interaction.options.getString('gender', true);
  const team = interaction.options.getString('team', true);
  const grade = interaction.options.getString('grade', true);

  await interaction.deferReply();

  const existingMember = await db.getMemberByDiscordId(user.id);
  if (existingMember) {
    await interaction.editReply('このユーザーは既に登録されています。');
    return;
  }

  const memberData = {
    name,
    discordDisplayName: interaction.guild?.members.cache.get(user.id)?.displayName || user.displayName,
    discordUsername: user.username,
    studentId,
    gender,
    team,
    membershipFeeRecord: '未納',
    grade,
  };

  // データバリデーション
  const validation = MemberValidator.validateMember(memberData);
  if (!validation.success) {
    const errors = 'errors' in validation ? validation.errors : ['バリデーションエラー'];
    await interaction.editReply({
      content: `❌ 入力データにエラーがあります:\n${errors.join('\n')}`,
    });
    return;
  }

  const member = validation.data;

  await db.insertMember(member, user.id);
  

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('✅ 部員登録完了')
    .setDescription(`${name} さんを部員として登録しました。`)
    .addFields(
      { name: 'Discord', value: `${user.tag}`, inline: true },
      { name: '学籍番号', value: studentId, inline: true },
      { name: '性別', value: gender, inline: true },
      { name: '班', value: team, inline: true },
      { name: '学年', value: `${grade}年生`, inline: true },
      { name: '部費状況', value: '未納', inline: true }
    )
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  logCommandUsage(interaction, '部員登録', user.username);
}

async function handleUpdate(
  interaction: ChatInputCommandInteraction,
  db: DatabaseService,
  sheetsService: GoogleSheetsService
) {
  const user = interaction.options.getUser('user', true);
  const field = interaction.options.getString('field', true);
  const value = interaction.options.getString('value', true);

  await interaction.deferReply();

  const existingMember = await db.getMemberByDiscordId(user.id);
  if (!existingMember) {
    await interaction.editReply('このユーザーは部員として登録されていません。');
    return;
  }

  // 更新データのバリデーション
  const updateData = { [field]: value };
  const updateValidation = MemberValidator.validateMemberUpdate(updateData);
  if (!updateValidation.success) {
    const errors = 'errors' in updateValidation ? updateValidation.errors : ['バリデーションエラー'];
    await interaction.editReply({
      content: `❌ 更新データにエラーがあります:\n${errors.join('\n')}`,
    });
    return;
  }

  // 既存メンバーデータをMemberオブジェクトに変換
  const currentMember = MemberConverter.dbRowToMember(existingMember);
  if (!currentMember) {
    await interaction.editReply('既存の部員データの変換に失敗しました。');
    return;
  }

  await db.updateMember(user.id, updateData);

  const updatedMember: Member = {
    ...currentMember,
    ...updateValidation.data,
  };


  const fieldNames: Record<string, string> = {
    name: '本名',
    discordDisplayName: 'Discord表示名',
    studentId: '学籍番号',
    gender: '性別',
    team: '班',
    grade: '学年',
  };

  const embed = new EmbedBuilder()
    .setColor('#ffaa00')
    .setTitle('✏️ 部員情報更新完了')
    .setDescription(`${existingMember.name} さんの情報を更新しました。`)
    .addFields({
      name: '更新内容',
      value: `**${fieldNames[field]}**: ${existingMember[field as keyof typeof existingMember]} → ${value}`,
      inline: false,
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  logCommandUsage(interaction, '部員情報更新', user.username);
}

async function handleDelete(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  const user = interaction.options.getUser('user', true);

  await interaction.deferReply();

  const existingMember = await db.getMemberByDiscordId(user.id);
  if (!existingMember) {
    await interaction.editReply('このユーザーは部員として登録されていません。');
    return;
  }

  // TODO: 実際の削除機能を実装（現在はupdateで空オブジェクトを渡している）
  // 削除機能を実装する場合は、DatabaseServiceにdeleteMemberメソッドを追加する必要があります
  await interaction.editReply('削除機能は現在実装中です。管理者にお問い合わせください。');
}

async function handleGradeUp(
  interaction: ChatInputCommandInteraction,
  db: DatabaseService,
  sheetsService: GoogleSheetsService
) {
  await interaction.deferReply();

  const embed = new EmbedBuilder()
    .setColor('#ffaa00')
    .setTitle('📚 学年一括繰り上げ')
    .setDescription('全部員の学年を繰り上げています...')
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  const members = await db.getAllMembers();
  let updated = 0;
  let newOB = 0;

  for (const dbMember of members) {
    const member = MemberConverter.dbRowToMember(dbMember);
    if (!member) continue;

    const currentGrade = typeof member.grade === 'number' ? member.grade : parseInt(String(member.grade));
    if (isNaN(currentGrade) || String(member.grade) === 'OB') continue;

    let newGrade: number;
    if (currentGrade >= 4) {
      // OBは文字列として扱うが、Memberのgradeは数値なので、大きな値で代用
      newGrade = 99; // OBを表す特別な値
      newOB++;
    } else {
      newGrade = currentGrade + 1;
    }

    await db.updateMember(dbMember.discord_id, { grade: newGrade.toString() });

    const updatedMember: Member = {
      ...member,
      grade: newGrade,
    };

      updated++;
  }

  embed
    .setColor('#00ff00')
    .setDescription('学年一括繰り上げが完了しました！')
    .addFields(
      { name: '更新された部員数', value: `${updated}名`, inline: true },
      { name: '新OB', value: `${newOB}名`, inline: true }
    );

  await interaction.editReply({ embeds: [embed] });
  logCommandUsage(interaction, '学年一括繰り上げ', `更新: ${updated}名, 新OB: ${newOB}名`);
}