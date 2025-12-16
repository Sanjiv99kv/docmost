import {
  IsIn,
  IsNotEmpty,
  IsNotIn,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  ValidateIf,
  validateSync,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  Validate,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsISO6391 } from '../../common/validator/is-iso6391';

export class EnvironmentVariables {
  // DATABASE_URL is completely optional - no validation, handled by custom validation function
  @IsOptional()
  DATABASE_URL: string;

  // Individual database parameters are required if DATABASE_URL is not provided
  @ValidateIf((obj) => !obj.DATABASE_URL)
  @IsNotEmpty({ message: 'DATABASE_HOST is required when DATABASE_URL is not provided' })
  @IsString()
  DATABASE_HOST: string;

  @ValidateIf((obj) => !obj.DATABASE_URL)
  @IsNotEmpty({ message: 'DATABASE_PORT is required when DATABASE_URL is not provided' })
  @IsString()
  DATABASE_PORT: string;

  @ValidateIf((obj) => !obj.DATABASE_URL)
  @IsNotEmpty({ message: 'DATABASE_USERNAME or DATABASE_USER is required when DATABASE_URL is not provided' })
  @IsString()
  DATABASE_USERNAME: string;

  @ValidateIf((obj) => !obj.DATABASE_URL)
  @IsNotEmpty({ message: 'DATABASE_PASSWORD is required when DATABASE_URL is not provided' })
  @IsString()
  DATABASE_PASSWORD: string;

  @ValidateIf((obj) => !obj.DATABASE_URL)
  @IsNotEmpty({ message: 'DATABASE_NAME or DATABASE_DB is required when DATABASE_URL is not provided' })
  @IsString()
  DATABASE_NAME: string;

  // Support alternative names (optional, used as fallback)
  @IsOptional()
  @IsString()
  DATABASE_USER: string;

  @IsOptional()
  @IsString()
  DATABASE_DB: string;

  @IsNotEmpty()
  @IsUrl(
    {
      protocols: ['redis', 'rediss'],
      require_tld: false,
      allow_underscores: true,
    },
    { message: 'REDIS_URL must be a valid redis connection string' },
  )
  REDIS_URL: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  APP_URL: string;

  @IsNotEmpty()
  @MinLength(32)
  @IsNotIn(['REPLACE_WITH_LONG_SECRET'])
  APP_SECRET: string;

  @IsOptional()
  @IsIn(['smtp', 'postmark'])
  MAIL_DRIVER: string;

  @IsOptional()
  @IsIn(['local', 's3'])
  STORAGE_DRIVER: string;

  @IsOptional()
  @ValidateIf((obj) => obj.COLLAB_URL != '' && obj.COLLAB_URL != null)
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  COLLAB_URL: string;

  @IsOptional()
  CLOUD: boolean;

  @IsOptional()
  @IsUrl(
    { protocols: [], require_tld: true },
    {
      message:
        'SUBDOMAIN_HOST must be a valid FQDN domain without the http protocol. e.g example.com',
    },
  )
  @ValidateIf((obj) => obj.CLOUD === 'true'.toLowerCase())
  SUBDOMAIN_HOST: string;

  @IsOptional()
  @IsIn(['database', 'typesense'])
  @IsString()
  SEARCH_DRIVER: string;

  @IsOptional()
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_tld: false,
      allow_underscores: true,
    },
    {
      message:
        'TYPESENSE_URL must be a valid typesense url e.g http://localhost:8108',
    },
  )
  @ValidateIf((obj) => obj.SEARCH_DRIVER === 'typesense')
  TYPESENSE_URL: string;

  @IsOptional()
  @ValidateIf((obj) => obj.SEARCH_DRIVER === 'typesense')
  @IsNotEmpty()
  @IsString()
  TYPESENSE_API_KEY: string;

  @IsOptional()
  @ValidateIf((obj) => obj.SEARCH_DRIVER === 'typesense')
  @IsISO6391()
  @IsString()
  TYPESENSE_LOCALE: string;

  @IsOptional()
  @ValidateIf((obj) => obj.AI_DRIVER)
  @IsIn(['openai', 'gemini', 'ollama'])
  @IsString()
  AI_DRIVER: string;

  @IsOptional()
  @ValidateIf((obj) => obj.AI_DRIVER)
  @IsString()
  @IsNotEmpty()
  AI_EMBEDDING_MODEL: string;

  @IsOptional()
  @ValidateIf((obj) => obj.AI_EMBEDDING_DIMENSION)
  @IsIn(['768', '1024', '1536'])
  @IsString()
  AI_EMBEDDING_DIMENSION: string;


  @IsOptional()
  @ValidateIf((obj) => obj.AI_DRIVER)
  @IsString()
  @IsNotEmpty()
  AI_COMPLETION_MODEL: string;

  @IsOptional()
  @ValidateIf((obj) => obj.AI_DRIVER && obj.AI_DRIVER === 'openai')
  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY: string;

  @IsOptional()
  @ValidateIf((obj) => obj.AI_DRIVER && obj.OPENAI_API_URL && obj.AI_DRIVER === 'openai')
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  OPENAI_API_URL: string;

  @IsOptional()
  @ValidateIf((obj) => obj.AI_DRIVER && obj.AI_DRIVER === 'gemini')
  @IsString()
  @IsNotEmpty()
  GEMINI_API_KEY: string;

  @IsOptional()
  @ValidateIf((obj) => obj.AI_DRIVER && obj.AI_DRIVER === 'ollama')
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  OLLAMA_API_URL: string;
}

export function validate(config: Record<string, any>) {
  // Custom validation: Check if either DATABASE_URL or all individual parameters are provided
  // This check runs BEFORE class-validator to prevent confusing error messages
  const hasDatabaseUrl = config.DATABASE_URL && 
    typeof config.DATABASE_URL === 'string' && 
    config.DATABASE_URL.trim() !== '';
  
  const hasIndividualParams = config.DATABASE_HOST && 
    config.DATABASE_PORT &&
    (config.DATABASE_USERNAME || config.DATABASE_USER) && 
    config.DATABASE_PASSWORD && 
    (config.DATABASE_NAME || config.DATABASE_DB);

  if (!hasDatabaseUrl && !hasIndividualParams) {
    // Debug: Show what's missing
    const missing = [];
    if (!config.DATABASE_HOST) missing.push('DATABASE_HOST');
    if (!config.DATABASE_PORT) missing.push('DATABASE_PORT');
    if (!config.DATABASE_USERNAME && !config.DATABASE_USER) missing.push('DATABASE_USERNAME or DATABASE_USER');
    if (!config.DATABASE_PASSWORD) missing.push('DATABASE_PASSWORD');
    if (!config.DATABASE_NAME && !config.DATABASE_DB) missing.push('DATABASE_NAME or DATABASE_DB');
    
    console.error(
      'The Environment variables has failed the following validations:',
    );
    console.error(JSON.stringify({
      databaseConfig: 'Either DATABASE_URL or all individual database parameters must be provided',
      missing: missing.length > 0 ? `Missing: ${missing.join(', ')}` : 'No individual parameters found'
    }));
    console.error(
      'Please fix the environment variables and try again. Exiting program...',
    );
    process.exit(1);
  }

  // If DATABASE_URL is provided, validate it's a valid PostgreSQL URL
  if (hasDatabaseUrl) {
    try {
      const url = new URL(config.DATABASE_URL);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        console.error(
          'The Environment variables has failed the following validations:',
        );
        console.error(JSON.stringify({
          databaseUrl: 'DATABASE_URL must be a valid postgres connection string (postgres:// or postgresql://)'
        }));
        console.error(
          'Please fix the environment variables and try again. Exiting program...',
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(
        'The Environment variables has failed the following validations:',
      );
      console.error(JSON.stringify({
        databaseUrl: 'DATABASE_URL must be a valid postgres connection string'
      }));
      console.error(
        'Please fix the environment variables and try again. Exiting program...',
      );
      process.exit(1);
    }
  }

  const validatedConfig = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(validatedConfig);

  if (errors.length > 0) {
    console.error(
      'The Environment variables has failed the following validations:',
    );

    errors.map((error) => {
      console.error(JSON.stringify(error.constraints));
    });

    console.error(
      'Please fix the environment variables and try again. Exiting program...',
    );
    process.exit(1);
  }

  return validatedConfig;
}
