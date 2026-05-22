import { PartialType } from '@nestjs/mapped-types';
import { CreateKnowledgeBaseArticleDto } from './create-knowledge-base-article.dto';

export class UpdateKnowledgeBaseArticleDto extends PartialType(CreateKnowledgeBaseArticleDto) {}